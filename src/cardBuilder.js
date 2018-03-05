const _ = require('lodash');
const util = require('util');
const Promise = require('bluebird');
const spawnSync = require('child_process').spawnSync;
const spawnAsync = util.promisify(require('child_process').spawn);
const cbu = require('./cardBuilderUtilities').cardBuilderUtilities;
const fs = Promise.promisifyAll(require('fs-extra'));
const cliArguments = require('commander');
const Throttle = require('promise-parallel-throttle');
const execAsync = require('async-child-process').execAsync;
const exec = require('child_process').exec;
const appName = "decced";

async function main() {

    var rootDir = '../';
    var assetsDir = cbu.mergePath(rootDir, 'Assets');
    try {
        cliArguments
            .allowUnknownOption(false)
            .version('1.0.1')
            .option('-c, --config [default]', 'Use the named configuration. [default]')
            .parse(process.argv);
    }
    catch (e) {
        console.error(appName + " encountered an error parsing command line arguments.\n\n"+e.message);
        e.messageShown = true;
        throw(e);
    }

    var defaultConfigJson = {};
    if (fs.existsSync("defaults.json")) {
        try {
            defaultConfigJson = JSON.parse(await fs.readFileAsync("defaults.json", { encoding: 'utf8' }));
        }
        catch (e) {
            console.error(appName + " encountered an error loading application defaults (src/defaults.json).\n");
            console.error(e.message);
            e.messageShown = true;
            throw(e);
        }
    }

    var configJson = await fs.readFileAsync("../config.json", { encoding: 'utf8' });
    var configs = JSON.parse(configJson);
    var configToUse = cliArguments.config || configs.build || "default";
    var genData = configs.builds[configToUse];
    if (!genData) {
        throw `build ${configToUse} is not defined.`;
    }
    
    genData.buildOptions = _.assign(defaultConfigJson, configs.options || {}, genData.options || {});
    genData.rootDir = genData.rootDir || rootDir;

    var lib = await loadLibrary(genData);
    genData.library = lib;

    genData.renderPath = cbu.mergePath(genData.renderPath || '../Renders/');
    genData.outputFile = genData.outputFile || 'cards.pdf';
    _.assign(genData, { "totalSheetCount": 0, "files": [] });
    try {
        await renderCards(genData);
        await convertCards(genData);
        await compileCards(genData);
        await cleanupCards(genData);
    }
    catch (e) {
        if (!e.messageShown) {
            console.error(appName + " encountered an unknown error.\n");
            console.error(e.message);
            e.messageShown = true;
        }
        throw(e);
    }
}

async function loadLibrary(genData) {
    var rootDir = genData.rootDir;
    var buildOptions = genData.buildOptions;
    var lib = {};
    var cardsDir = cbu.mergePath(rootDir, 'Cards');
    var cardsDirFolders = await fs.readdirAsync(cardsDir);
    for (var cardFolder of cardsDirFolders) {
        var cardPath = cbu.mergePath(cardsDir, cardFolder);
        var cardJsPath = cbu.mergePath(cardPath, 'card.js');
        var cardJsExists = fs.existsSync(cardJsPath);
        if (cardJsExists && !fs.existsSync(cbu.mergePath(cardPath, 'ignore.txt'))) {
            //has card driver
            var cardConstructor = require(cardJsPath).Card;
            var cardOptionsPath = cbu.mergePath(cardsDir, cardFolder, 'options.json');
            var cardOptions = _.assign({}, buildOptions);
            if (fs.existsSync(cardOptionsPath)) {
                var cardOptionsFileText = await fs.readFileAsync(cardOptionsPath);
                var jsonOptions = JSON.parse(cardOptionsFileText);
                cardOptions = _.assign(cardOptions, jsonOptions || {});
            }
            if (!cardOptions.ignore) {
                cardOptions.cardsPath = cardsDir;
                cardOptions.cardPath = cardPath;
                cardOptions.rootPath = rootDir;
                cardOptions.cardName = cardOptions.cardName || cardFolder;
                var cardDriver = new cardConstructor(cardOptions);
                lib[cardOptions.cardName] = cardDriver;
            }
        }
        else {
            var cardOptionsPath = cbu.mergePath(cardsDir, cardFolder, 'options.json');
            var cardOptions = _.assign({}, buildOptions);
            if (fs.existsSync(cardOptionsPath)) {
                //infering it's a card by the existance of the options.json file.
                var cardOptionsFileText = await fs.readFileAsync(cardOptionsPath);
                var jsonOptions = JSON.parse(cardOptionsFileText);
                cardOptions = _.assign(cardOptions, jsonOptions || {});
                if (!cardOptions.ignore) {
                    cardOptions.cardsPath = cardsDir;
                    cardOptions.cardPath = cardPath;
                    cardOptions.rootPath = rootDir;
                    cardOptions.cardName = cardOptions.cardName || cardFolder;
                    var cardConstructor = require('./defaultCard.js').Card;
                    var cardDriver = new cardConstructor(cardOptions);
                    lib[cardOptions.cardName] = cardDriver;
                }
            }
        }
    }
    return lib;
}

async function probeForFile(probes, exes) {
    var found = null;
    try {
        for (var i = 0; i < probes.length; i++) {
            var probe = cbu.mergePath("c:", probes[i]);
            for (var k = 0; k < exes.length; k++) {
                var probedDir = cbu.mergePath(probe, exes[k]);
                if (fs.existsSync(probedDir)) {
                    found = probedDir;
                    break;
                }
                if (found) {
                    break;
                }
            }
            if (found) {
                break;
            }
        }
    }
    catch (e) {
        console.warn(appName + " encountered an error probing for file(s) "+exes.join(", ")+".");
        e.messageShown = true;
    }
    return found;
}

async function renderCards(genData){
    var lib = genData.library;
    if (typeof(genData.tasks['render']) == 'undefined' || genData.tasks['render']) {
        console.info('Render');
        for (var card of genData.cards)
         {
            console.info(' <- ' + card);
            if (!lib[card]) {
                throw card + ' is not defined in the card library.';
            }
            await lib[card].Generate(genData).catch(e=>console.log(e));
            console.info(' -> ' + card);
        }
        console.info('Rendered');
    }
}

async function convertCards(genData) {
    try {
        if (typeof(genData.tasks['convert']) == 'undefined' || genData.tasks['convert']) {
            console.info('Convert');
            var inkscape = 'inkscape.exe';
            if (_.isString(genData.tasks['convert'])) {
                inkscape = cbu.mergePath(genData.tasks['convert'], inkscape);
            }
            else {
                var exists = fs.existsSync(inkscape);
                if (!exists) {
                    var found = await probeForFile(["/program files/inkscape", "/program files (x86)/inkscape"], ["inkscape.exe"]);
                    inkscape = found || inkscape;
                }
            }
            
            if (genData.buildOptions.maxInProgress <= 0){
                await Promise.all(genData.files.map(file => convertFileAsync(genData, inkscape, file)));
            }
            else {
                var queue = genData.files.map(file => () => convertFileAsync(genData, inkscape, file));
                await Throttle.all(queue, {maxInProgress:genData.buildOptions.maxInProgress});
            }
            console.info('Converted');
        }
    }
    catch(e){
        if (!e.messageShown) {
            console.error(`There was an error converting files to postscript. \n${e.message}`);
            e.messageShown = true;
        }
        throw(e);
    }
}

function convertFileAsync(genData, inkscape, file){
    console.info(' <- ' + file.fileName);
    return new Promise((resolve,reject)=>
    {
        var psFileName = file.fileName.replace('.svg', '.ps');
        execAsync(`"${inkscape}" -P=${psFileName} -d300 -z ${file.fileName}`, {cwd: genData.renderPath})
        .then(value => {
            console.info(' -> ' + psFileName);
            resolve(value);
        })
        .catch(e=>
        {
            if (!e.messageShown) {
                console.error(`There was an error converting ${file.fileName} to postscript. \n${e.message}`);
                e.messageShown = true;
            }
            reject(e);
        });
    });
}

async function compileCards(genData) {
    try {
        var buildOptions = genData.buildOptions;
        if (typeof (genData.tasks['compile']) === 'undefined' || genData.tasks['compile']) {
            var gs = 'gswin64c.exe';
            if (_.isString(genData.tasks['compile'])) {
                gs = cbu.mergePath(genData.tasks['compile'], gs);
            }
            else {
                var exists = fs.existsSync(gs);
                if (!exists) {
                    var found = await probeForFile(["/program files/gs", "/program files (x86)/gs"], ["gswin64c.exe", "gswin32c.exe", "gswinc.exe"]);
                    gs = found || gs;
                }
            }
            console.info('Compile');
            _.forEach(genData.files, function (file) {
                console.info(' <- ' + file.fileName.replace('.svg', '.ps'));
            });
            //TODO: Handle errors
            var actualOutputFile = cbu.mergePath(genData.renderPath, genData.outputFile);
            if (!buildOptions.replaceOutput) {
                actualOutputFile = cbu.nextFileName(genData.renderPath, genData.outputFile);
            }
            if (!buildOptions.skipMainPdf) {
                var y = spawnSync(gs, ['-r300x300', '-sDEVICE=pdfwrite', '-o', actualOutputFile].concat(_.map(genData.files, function (file) { return file.fileName.replace('.svg', '.ps'); })), { cwd: genData.renderPath });
            }
            console.info(' -> ' + actualOutputFile);
            console.info('Compiled');
            if (buildOptions.breakoutPdfs) {
                var byCard = _.groupBy(genData.files, function (file) { return file.cardName });
                _.forEach(byCard, function (g, cardName) {
                    console.info('Compile');
                    _.forEach(g, function (file) {
                        console.info(' <- ' + file.fileName.replace('.svg', '.ps'));
                    });
                    actualOutputFile = cbu.mergePath(genData.renderPath, cardName + '.pdf');
                    if (!buildOptions.replaceOutput) {
                        actualOutputFile = cbu.nextFileName(genData.renderPath, cardName + '.pdf');
                    }
                    var y = spawnSync(gs, ['-r300x300', '-sDEVICE=pdfwrite', '-o', actualOutputFile].concat(_.map(g, function (file) { return file.fileName.replace('.svg', '.ps'); })), { cwd: genData.renderPath });
                    console.info(' -> ' + actualOutputFile);
                    console.info('Compiled');
                });
            }
        }
    }
    catch (e) {
        if (!e.messageShown) {
            console.error(`There was an error compiling cards to pdf. \n${e.message}`);
            e.messageShown = true;
        }
        throw(e);
    }
}

async function cleanupCards(genData) {
    try {
        var clean = genData.tasks['clean'];
        if (clean === true || typeof (clean) === 'undefined') {
            clean = genData.cleanup || ["ps", "svg"];
        }
        if (clean) {
            var cleanup;
            if (_.isArray(clean)) {
                cleanup = clean;
            }

            console.info('Clean');
            cbu.purgeFiles(genData.renderPath, cleanup || [], function (file) {
                console.info(' -> ' + file);
            });
            console.info('Cleaned');
        }
    }
    catch (e) {
        if (!e.messageShown) {
            console.error(`There was an error cleaning up. \n${e.message}`);
            e.messageShown = true;
        }
        throw(e);
    }
}

main()
.then(r => {
    process.exit()
})
.catch(e=>{
    if (!e.messageShown) {
        console.error(e.message);
    }
    console.error(appName + " failed wonderfully.");
});