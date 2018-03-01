const _ = require('lodash');
const util = require('util');
const Promise = require('bluebird');
const spawnSync = require('child_process').spawnSync;
const spawnAsync = util.promisify(require('child_process').spawn);
const cbu = require('./cardBuilderUtilities').cardBuilderUtilities;
const fs = Promise.promisifyAll(require('fs-extra'));
const cliArguments = require('commander');
const Throttle = require('promise-parallel-throttle');


async function main() {

    var rootDir = '../';
    var assetsDir = cbu.mergePath(rootDir, 'Assets');

    cliArguments
        .version('0.1.0')
        .option('-c, --config [default]', 'Use the named configuration. [default]')
        //.option('-l, --list', 'List of cards to create.')
        .parse(process.argv);

    var defaultConfigJson = {};
    if (fs.existsSync("defaults.json")) {
        defaultConfigJson = JSON.parse(await fs.readFileAsync("defaults.json", { encoding: 'utf8' }));
    }

    var configJson = await fs.readFileAsync("../config.json", { encoding: 'utf8' });
    var configs = JSON.parse(configJson);
    var configToUse = cliArguments.config || configs.build || "default";
    var genData = configs.builds[configToUse];
    if (!genData) {
        throw `build ${configToUse} is not defined.`;
    }
    var buildOptions = _.assign(defaultConfigJson, configs.options || {}, genData.options || {});

    var lib = await loadLibrary(rootDir,  buildOptions);

    var renderPath = cbu.mergePath(genData.renderPath || '../Renders/');
    genData.outputFile = genData.outputFile || 'cards.pdf';
    _.assign(genData, { "totalSheetCount": 0, "files": [] });

    if (typeof(genData.tasks['render']) == 'undefined' || genData.tasks['render']) {
        console.info('Render');
        for (var card of genData.cards)
         {
            console.info(' <- ' + card);
            if (!lib[card]) {
                throw card + ' is not defined in the card library.';
            }
            await lib[card].Generate(genData).catch(e=>console.exception(e));
            console.info(' -> ' + card);
        }
        console.info('Rendered');
    }

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
        
        var queue = genData.files.map(file => () => convertFile(inkscape, file, renderPath));
        await Throttle.all(queue, {maxInProgress:2});
        console.info('Converted');
    }

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
        var actualOutputFile = cbu.mergePath(renderPath, genData.outputFile);
        if (!buildOptions.replaceOutput) {
            actualOutputFile = cbu.nextFileName(renderPath, genData.outputFile);
        }
        if (!buildOptions.skipMainPdf) {
            var y = spawnSync(gs, ['-r300x300', '-sDEVICE=pdfwrite', '-o', actualOutputFile].concat(_.map(genData.files, function (file) { return file.fileName.replace('.svg', '.ps'); })), { cwd: renderPath });
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
                actualOutputFile = cbu.mergePath(renderPath, cardName + '.pdf');
                if (!buildOptions.replaceOutput) {
                    actualOutputFile = cbu.nextFileName(renderPath, cardName + '.pdf');
                }
                var y = spawnSync(gs, ['-r300x300', '-sDEVICE=pdfwrite', '-o', actualOutputFile].concat(_.map(g, function (file) { return file.fileName.replace('.svg', '.ps'); })), { cwd: renderPath });
                console.info(' -> ' + actualOutputFile);
                console.info('Compiled');
            });
        }
    }

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
        cbu.purgeFiles(renderPath, cleanup || [], function (file) {
            console.info(' -> ' + file);
        });
        console.info('Cleaned');
    }
}

async function loadLibrary(rootDir, buildOptions){
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
                cardOptions.resources = cardOptions.resources || require('./resourceCodes');
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
                    cardOptions.resources = cardOptions.resources || require('./resourceCodes');
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
    return found;
}

async function convertFile(inkscape, file, renderPath){
    console.info(' <- ' + file.fileName);
    //TODO: Handle errors
    //Just crashes if it's spawnAsync...?
    var x = spawnSync(inkscape, ['-P=' + file.fileName.replace('.svg', '.ps'), '-d300', '-z', file.fileName], { cwd: renderPath });
    console.info(' -> ' + file.fileName.replace('.svg', '.ps'));
    return x;
}

main().then(r => process.exit());