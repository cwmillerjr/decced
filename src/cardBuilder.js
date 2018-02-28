const _ = require('lodash');
const spawnSync = require('child_process').spawnSync;
const cbu = require('./cardBuilderUtilities').cardBuilderUtilities;
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs-extra'));
const cliArguments = require('commander');


async function main() {

    cliArguments
        .version('0.1.0')
        .option('-c, --config [default]', 'Use the named configuration. [default]')
        //.option('-l, --list', 'List of cards to create.')
        .parse(process.argv);

    var lib = {};

    var rootDir = '../';
    var cardsDir = cbu.mergePath(rootDir, 'Cards');
    var assetsDir = cbu.mergePath(rootDir, 'Assets');

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

    var cardsDirFolders = await fs.readdirAsync(cardsDir);
    for (var cardFolder of cardsDirFolders) {
        var cardPath = cbu.mergePath(cardsDir, cardFolder);
        var cardJsPath = cbu.mergePath(cardPath, 'card.js');
        var cardJsExists = fs.existsSync(cardJsPath);
        if (cardJsExists && !fs.existsSync(cbu.mergePath(cardPath, 'ignore.txt'))) {
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



    var renderPath = cbu.mergePath(genData.renderPath || '../Renders/');

    genData.outputFile = genData.outputFile || 'cards.pdf';

    _.assign(genData, { "totalSheetCount": 0, "files": [] });

    var temp;
    temp = genData.tasks['render'];
    if (typeof (temp) === 'undefined') {
        temp = true;
    }

    if (temp) {
        console.info('Render');
        for (var card of genData.cards)
         {
            console.info(' <- ' + card);
            if (!lib[card]) {
                throw card + ' is not defined in the card library.';
            }
            await lib[card].Generate(genData).catch
            (
                e=>console.log(e)
        );
            console.info(' -> ' + card);
        }
        console.info('Rendered');
    }

    temp = genData.tasks['convert'];
    if (typeof (temp) === 'undefined') {
        temp = true;
    }
    if (temp) {
        console.info('Convert');
        var inkscape = 'inkscape.exe';
        if (_.isString(genData.tasks['convert'])) {
            inkscape = cbu.mergePath(genData.tasks['convert'], inkscape);
        }
        else {
            var exists = fs.existsSync(inkscape);
            if (!exists) {
                var probes = ["/program files/inkscape", "/program files (x86)/inkscape"];
                var exes = ["inkscape.exe"];
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
                inkscape = found || inkscape;
            }
        }
        _.forEach(genData.files, function (file) {
            console.info(' <- ' + file.fileName);
            //TODO: Handle errors

            var x = spawnSync(inkscape, ['-P=' + file.fileName.replace('.svg', '.ps'), '-d300', '-z', file.fileName], { cwd: renderPath });
            console.info(' -> ' + file.fileName.replace('.svg', '.ps'));
        });
        console.info('Converted');
    }

    temp = genData.tasks['compile'];
    if (typeof (temp) === 'undefined') {
        temp = true;
    }
    if (temp) {
        var gs = 'gswin64c.exe';
        var found = null;
        if (_.isString(genData.tasks['compile'])) {
            gs = cbu.mergePath(genData.tasks['compile'], gs);
        }
        else {
            var exists = fs.existsSync(gs);
            if (!exists) {
                var probes = ["/program files/gs", "/program files (x86)/gs"];
                var exes = ["gswin64c.exe", "gswin32c.exe", "gswinc.exe"];
                for (var i = 0; i < probes.length; i++) {
                    var probe = cbu.mergePath("c:", probes[i]);
                    if (fs.existsSync(probe)) {
                        var subdir = fs.readdirSync(probe);
                        for (var j = 0; j < subdir.length; j++) {
                            for (var k = 0; k < exes.length; k++) {
                                var probedDir = cbu.mergePath(probe, subdir, "bin", exes[k]);
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
                    if (found) {
                        break;
                    }
                }
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
        // else {
        //     cleanup = genData.cleanup || ["ps","svg"];
        // }

        console.info('Clean');
        cbu.purgeFiles(renderPath, cleanup || [], function (file) {
            console.info(' -> ' + file);
        });
        console.info('Cleaned');
    }
}

main().then(r => process.exit());