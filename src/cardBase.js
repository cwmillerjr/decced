module.exports = {
    CardBase: CardBase
}

var Promise = require('bluebird');
var x2j = Promise.promisifyAll(require('xml2js'));
var fs = Promise.promisifyAll(require('fs-extra'));
var _ = require('lodash');
var cbu = require('./cardBuilderUtilities').cardBuilderUtilities;
var traverse = require('traverse');
var NW = require('./nodeWrapper').NodeWrapper;

function CardBase(options) {

    this.options = parseOptions(options);

    var Card = CardBase.caller;

    Card.prototype = Object.create(CardBase.prototype);
    Card.prototype.constructor = Card;

    var _self = this;

    this.Name = function (val) {
        if (arguments.length > 0) {
            _self.options.cardName = val;
        }
        else {
            return _self.options.cardName;
        }
    }

    this.ManifestLoader = function (manifest, format) {
        try {
            var parsedRows = cbu.parseManifest(manifest, format, _self.options.minManifestColumns);
            if (parsedRows.length > 0 && parsedRows[0].length > 0 && parsedRows[0][0][0] === '$') {
                _self.options.columnNames = parsedRows[0];
                _self.options.columnNames[0] = _self.options.columnNames[0].substr(1);
                parsedRows.splice(0, 1);
            }
            if (parsedRows.length > 0 && parsedRows[0].length > 0 && parsedRows[0][0][0] === '^') {
                _self.options.defaultManifest = parsedRows[0];
                _self.options.defaultManifest[0] = _self.options.defaultManifest[0].substr(1);
                parsedRows.splice(0, 1);
            }
            var mappedObjects = _.map(parsedRows, function (parsedRow) {
                var mappedObject = _self.options.manifestMapper.call(_self, parsedRow, _self.options);
                return mappedObject;
            });
            return mappedObjects;
        }
        catch (e) {
            console.error(`Could not parse manifest file.`);
            e.messageShown = true;
            console.error(e.message);
            throw e;
        }
    }

    this.Generate = async function (generationData, svgTemplate, manifest) {

        var options = _self.options;
        var cardFormatFileSuffix = options.format || "";
        if (cardFormatFileSuffix) {
            cardFormatFileSuffix = '.' + cardFormatFileSuffix;
        }

        generationData = generationData || { totalSheetCount: -1, files: [] };
        var renderPath = generationData.renderPath || _self.options.renderPath;

        //normalize path
        renderPath = cbu.mergePath(renderPath);
        if (!fs.existsSync(renderPath)) {
            await fs.mkdirAsync(renderPath);
        }


        //running total of all card sheets in the rendering process used to order filenames
        var totalSheetCount = generationData.totalSheetCount;
        var svgTemplate = generationData.svgTemplate;
        var manifest = generationData.manifest;

        //divine the svgTemplate to use
        if (!svgTemplate) {
            if (_self.options.svgTemplatePath) {
                svgTemplate = _self.options.svgTemplatePath;
            }
            else {
                svgTemplate = cbu.mergePath(_self.options.cardPath, _self.options.cardFace);
            }
        }
        //if it's a string, assume it's a path to an svg and load it
        if (typeof svgTemplate === 'string') {
            svgTemplate = await fs.readFileAsync(svgTemplate);
        }

        var alignTemplate = await fs.readFileAsync(`./Alignment${cardFormatFileSuffix}._svg`);
        var clipPathsTemplate = await fs.readFileAsync(`./ClipPaths${cardFormatFileSuffix}._svg`)

        //divine the manifest to use
        var format = 'tab';
        if (!manifest) {
            if (_.endsWith(_self.options.manifestPath, 'xlsx')) {
                manifest = await fs.readFileAsync(_self.options.manifestPath);
                format = 'xlsx';
            }
            else {
                manifest = await fs.readFileAsync(_self.options.manifestPath, { encoding: 'utf8' });
            }
        }

        //parse the manifest into manifest objects
        manifest = _self.ManifestLoader(manifest, format);

        var alignDom = await x2j.parseStringAsync(alignTemplate);
        var clipDom  = await x2j.parseStringAsync(clipPathsTemplate);
        var svgDom   = await x2j.parseStringAsync(svgTemplate);


        removeAbsoluteReferences(svgDom);
        var data = { manifest: manifest, totalSheetCount: totalSheetCount, self: _self, renderPath: renderPath, generationData: generationData };
        await generateCardSheets(svgDom, data, alignDom, clipDom);
        totalSheetCount = data.totalSheetCount;

        generationData.totalSheetCount = totalSheetCount;
    }

    function injectAlignmentDomFragment(svgDom, alignDom){
        if (svgDom.svg.g) {
            var found = false;
            for (var i = 0; i < svgDom.svg.g.length; i++) {
                if (svgDom.svg.g[i] && svgDom.svg.g[i].$ && svgDom.svg.g[i].$.id == "AlignmentLayer") {
                    found = true;
                    break;
                }
            }
            if (!found) {
                svgDom.svg.g.push(alignDom.g);
            }
        }
    }


    async function generateCardSheets(svgDom, data, alignDom, clipDom) {
        var manifest = data.manifest;
        var totalSheetCount = data.totalSheetCount;
        var _self = data.self;
        var hasCards = false;
        var cardTemplateNode;
        var cardTemplateNodeParent;
        var options = _self.options;
        var renderPath = data.renderPath;
        var generationData = data.generationData;
        var cardsPerSheet = options.cardsPerSheet || 8;
        var backs = null;
        var face = 'front';


        //root positions to place the cloned cards
        var cardPositions = options.cardPositions;
        var svgAttributes = options.svgAttributes;
        var translateOffset = options.translateOffset;
        var clip = options.clip;


        var nodePredicate = function(node) {
            return (node.$.id == 'Card_T' || node.$.id === 'Card$');
        }

        //generate card template
        generateTemplate(options, svgDom, alignDom, clipDom, cardPositions, nodePredicate, face, clip, svgAttributes, translateOffset, cardsPerSheet);

        //get a dictionary of elements by their ids.
        var svgMap = cbu.mapSvg(svgDom);

        //delete existing rendered svg pages.
        cbu.purgeSheets(options.cardName, renderPath);

        var xmlBuilder = new x2j.Builder({ renderOpts: { pretty: true } });

        var cardSheet = 1;
        var cardIndex = 1;
        var countPrefix = '';

        //load the card back svg file to render after each card sheet for printing 2 sided
        var backs = null;
        if (options.backs) {
            var svgDom2 = await loadBacks(options, alignDom, clipDom);
            injectAlignmentDomFragment(svgDom2, alignDom)
            setCropMarks(svgDom2, 'back', options);
            backs = xmlBuilder.buildObject(svgDom2);
        }

        var blackout = null;
        if (options.blackout) {
            var svgDom2 = await loadBlackout(options);
            injectAlignmentDomFragment(svgDom2, alignDom)
            setCropMarks(svgDom2, 'blackout', options, false);
            blackout = xmlBuilder.buildObject(svgDom2);
        }

        var blank = null;
        if (options.blackout && options.backs) {
            var svgDom2 = await loadBlank(options);
            injectAlignmentDomFragment(svgDom2, alignDom)
            setCropMarks(svgDom2, 'blank', options, false);
            blank = xmlBuilder.buildObject(svgDom2);
        }

        var docs = [null, blackout, backs, blank];

        var fileName;
        var sheetPath;

        var take = options.take;
        var skip = options.skip || 0;

        var startAt = skip + 1;
        var stopAt = take; //false case
        if (take) {
            stopAt = startAt + take;
        }

        var cardManifests = [];

        for (var i = 0; i < manifest.length; i++) {
            var item = manifest[i];
            cardManifests.push(item);
            //map the cards on the page
            options.svgMapper.call(_self, item, cardIndex, svgMap, options);
            cardIndex++;
            //render a page once you've rendered the number of cards on the page
            if (cardIndex > cardsPerSheet) {
                var svgDocument = xmlBuilder.buildObject(svgDom);

                if (totalSheetCount >= 0) {
                    totalSheetCount++;
                }

                docs[0] = svgDocument;
                if (cardSheet >= startAt && (!stopAt || cardSheet < stopAt)) {
                    await saveSheets(totalSheetCount, cardSheet, renderPath, generationData, cardManifests, docs);
                    cardManifests = [];
                }
                cardSheet++;
                cardIndex = 1;
            }
        }
        if (options.blankCards) {
            var r = /^([0-9]+)(s|c)?$/;
            var m = options.blankCards.match(r);
            var additionalCards = 0;
            //number of cards requested is in sheets
            if (m[2] === 's') {
                additionalCards = cardsPerSheet * m[1];
                if (cardIndex > 1 && cardIndex <= cardsPerSheet) {
                    additionalCards += ((cardsPerSheet + 1) - cardIndex);
                }
            }
            else {
                additionalCards = m[1] * 1;
            }
            var empty = options.manifestMapper.call(_self);
            for (; additionalCards > 0; additionalCards--) {
                //map the cards on the page
                options.svgMapper.call(_self, empty, cardIndex, svgMap, options);
                cardManifests.push(empty);
                cardIndex++;
                //render a page once you've rendered the number of cards on the page
                if (cardIndex > cardsPerSheet) {
                    var svgDocument = xmlBuilder.buildObject(svgDom);

                    if (totalSheetCount >= 0) {
                        totalSheetCount++;
                    }

                    docs[0] = svgDocument;
                    if (cardSheet >= startAt && (!stopAt || cardSheet < stopAt)) {
                        await saveSheets(totalSheetCount, cardSheet, renderPath, generationData, cardManifests, docs);
                        cardManifests = [];
                    }

                    cardSheet++;
                    cardIndex = 1;
                }
            };
        }
        //if you have a partial sheet, pad out the remaining unfilled positions (otherwise they will render the previous page's cards) and save the partial sheet
        if (cardIndex != 1 && cardIndex <= cardsPerSheet) {
            var empty = options.manifestMapper.call(_self);
            while (cardIndex <= cardsPerSheet) {
                //what's the difference?
                if (svgMap['Card' + cardIndex]) {
                    //blank card
                    cbu.setDisplay(svgMap['Card' + cardIndex].$, false);
                }
                else {
                    options.svgMapper.call(_self, empty, cardIndex, svgMap, options);
                }
                cardManifests.push(empty);
                cardIndex++;
            }
            var svgDocument = xmlBuilder.buildObject(svgDom);
            if (totalSheetCount >= 0) {
                totalSheetCount++;
            }

            docs[0] = svgDocument;
            if (cardSheet >= startAt && (!stopAt || cardSheet < stopAt)) {
                await saveSheets(totalSheetCount, cardSheet, renderPath, generationData, cardManifests, docs);
            }
            cardSheet++;
            cardIndex = 1;
        }
        data.totalSheetCount = totalSheetCount;
    }

    function generateTemplate(options, svgDom, alignDom, clipDom, cardPositions, nodePredicate, face, clip, svgAttributes, translateOffset, cardsPerSheet) {
        injectAlignmentDomFragment(svgDom, alignDom);
        setCropMarks(svgDom, face, options);
        
        if (svgDom.svg.defs && clip) {
            if (typeof (svgDom.svg.defs[0].clipPath) === 'undefined') {
                svgDom.svg.defs[0].clipPath = [];
            }
            for (var def of clipDom.defs.clipPath) {
                for (var existingDef of svgDom.svg.defs[0].clipPath) {
                    if (def.id == existingDef.id) {
                        continue;
                    }
                }
                svgDom.svg.defs[0].clipPath.push(def);
            }
        }

        if (svgAttributes) {
            for (var attribute in svgAttributes) {
                svgDom.svg.$[attribute] = svgAttributes[attribute];
            }
        }

        //find the card template element in the svg file
        traverse(svgDom).forEach(function (node) {
            if (node.$ && node.$.id) {
                if (nodePredicate(node)) {
                    cardTemplateNode = node;
                    cardTemplateNodeParent = this.parent.node;
                }
            }
        });

        //figure out if the svg needs positions to be offset
        var cardPositionTranslations = [];
        var xOff = 0;
        var yOff = 0;

        if (translateOffset) {
            if (translateOffset.x) {
                xOff = translateOffset.x;
            }
            if (translateOffset.y) {
                yOff = translateOffset.y;
            }
        }

        //create card position (svg "translate" attributes) array using the root and any offsets
        for (var x = 0; x < cardPositions.x.length; x++) {
            for (var y = 0; y < cardPositions.y.length; y++) {
                var xPos = cardPositions.x[x] + xOff;
                var yPos = cardPositions.y[y] + yOff;
                cardPositionTranslations.push(`translate(${xPos},${yPos})`);
            }
        }

        var cardsInSheet = 0;
        //clone the template for each position and insert it into the svg.
        cardPositionTranslations.forEach(function (translate, index) {
            if (cardsInSheet++ < cardsPerSheet) {
                var aCard = traverse(cardTemplateNode).clone();
                aCard.$.transform = translate;
                if (clip) {
                    aCard.$["clip-path"] = `url(#card${face}ClipPath)`;
                }
                traverse(aCard).forEach(function (node) {
                    if (node.$ && node.$.id) {
                        node.$.id = node.$.id.replace('_T', index + 1).replace('$', index + 1);
                    }
                });
                cardTemplateNodeParent.push(aCard);
            }
        });
    }

    function setCropMarks(dom, cropMarkKey, options, showStandardAlignmentHoles) {

        if (typeof (showStandardAlignmentHoles) === 'undefined') {
            showStandardAlignmentHoles = true;
        }

        var showTicks = false;

        if (options.cropMarks && (options.cropMarks === cropMarkKey || (_.isArray(options.cropMarks) && _.includes(options.cropMarks, cropMarkKey)))) {
            showTicks = true;
        }

        traverse(dom).forEach(function (node) {
            if (this.parent && this.parent.node && this.parent.node.$ && this.parent.node.$.id == 'Alignment') {
                _.forEach(this.parent.node.g, function (alignmentNode) {
                    var display = false;
                    switch (alignmentNode.$.id) {
                        case 'Ticks':
                        case 'ExtendedTicks':
                            display = showTicks;
                            break;
                        case 'StandardAlignmentHoles':
                            display = showStandardAlignmentHoles;
                            break;
                        default:
                            display = false;
                    }
                    cbu.setDisplay(alignmentNode.$, display);
                });
            }
        });
    }

    async function saveSheet(count, cardSheet, renderPath, generationData, cardSheetOrdinal, cardManifests, svgDocument) {
        var prefix = '0000' + count.toString();
        prefix = prefix.substr(prefix.length - 4);
        var fileName = _self.options.fileNameGenerator(prefix, cardSheetOrdinal, cardSheet, _self.options, cardManifests)
        var sheetPath = cbu.mergePath(renderPath, fileName);
        if (!_.some(generationData.files, ['fileName', fileName])) {
            console.log('      ' + fileName);
            generationData.files.push({
                fileName: fileName,
                cardName: _self.options.cardName
            });
            await fs.writeFileAsync(sheetPath, svgDocument);
        }
    }

    async function saveSheets(count, cardSheet, renderPath, generationData, cardManifests, svgDocument1, svgDocument2, svgDocument3) {
        var docs;
        if (_.isArray(svgDocument1)) {
            docs = svgDocument1;
        }
        else {
            docs = arguments.slice(4);
        }

        var c = 0;
        for (var i = 0; i < docs.length; i++) {
            if (docs[i]) {
                await saveSheet(count, cardSheet, renderPath, generationData, c++, cardManifests, docs[i]);
            }
        }
    }

    function parseOptions(options) {
        if (!options.rootPath) {
            options.rootPath = '../';
        }
        if (!options.cardsPath) {
            options.cardsPath = cbu.mergePath(options.rootPath, 'Cards');
        }
        if (!options.cardFace) {
            options.cardFace = 'CardFace.svg';
        }
        if (!options.cardBack) {
            options.cardBack = 'CardBack.svg';
        }
        if (!options.cardPath) {
            options.cardPath = cbu.mergePath(options.cardsPath, options.cardName);
        }
        if (!options.manifestsPath) {
            options.manifestsPath = cbu.mergePath(options.rootPath, 'Manifests');
        }
        if (!options.manifestPath) {
            options.manifestPath = cbu.mergePath(options.manifestsPath, options.cardName + 'manifest' + (options.manifestSuffix || "") + '.xlsx');
        }
        if (!options.assetPath) {
            options.assetPath = cbu.mergePath(options.cardPath, '/Assets/');
        }
        else {
            options.assetPath = cbu.mergePath(options.assetPath, '/');
        }
        if (!options.defaultHeroImage) {
            options.defaultHeroImage = cbu.mergePath(options.assetPath, 'defaultHeroImage.png')
        }
        else {
            options.defaultHeroImage = cbu.mergePath(options.defaultHeroImage);
        }
        if (options.renderPath) {
            options.renderPath = cbu.mergePath(options.renderPath, '/');
        }

        if (!options.manifestMapper) {
            options.manifestMapper = defaultManifestMapper;
        }

        if (!options.svgMapper) {
            options.svgMapper = defaultSvgMapper;
        }

        return _.assign({},
            {
                renderPath: '../Renders/',
            },
            options || {});
    }

    function defaultManifestMapper(columns, options) {
        var currentColumn = 0;
        columns = columns || [];
        var cardManifest = {};
        if (typeof (columns) === 'undefined' || columns === null || columns.length == 0) {
            options = _self.options;
            for (var i = 0; i < options.columnNames.length; i++) {
                cardManifest[options.columnNames[i]] = null;
            }
            _.assign(cardManifest, options.defaultManifest || {});
        }
        else if (options.columnNames) {
            for (var i = 0; i < options.columnNames.length; i++) {
                cardManifest[options.columnNames[i]] = columns[i];
            }
        }
        else {
            cardManifest = columns;
        }
        return cardManifest;
    }

    function defaultNodeMapper(cardIndex, svgMap, options) {
        var map = {}
        if (options.columnNames) {
            for (var i = 0; i < options.columnNames.length; i++) {
                map[options.columnNames[i]] = NW.wrap(svgMap[options.columnNames[i] + cardIndex]);
            }
        }
        return map;
    }

    this.probeImage = function (imageName, options) {
        if (!imageName) {
            imageName = '';
        } else if (imageName.indexOf('/') < 0) {
            if (imageName.indexOf('.' < 0)) {
                imageName = imageName + '.png';
            }
            imageName = cbu.probePaths(imageName, options.assetPath, options.cardPath, cbu.mergePath(options.rootPath, 'Assets'));
        }
        return imageName;
    }

    function defaultSvgMapper(manifest, cardIndex, svgMap, options) {
        var map = defaultNodeMapper(cardIndex, svgMap, options);
        if (options.columnNames) {
            for (var i = 0; i < options.columnNames.length; i++) {
                var nodeMap = map[options.columnNames[i]];
                if (nodeMap._raw.type === 'image') {
                    var val = manifest[options.columnNames[i]];
                    val = _self.probeImage(val, options);
                    nodeMap.val(val);
                    nodeMap.setDisplay(!!manifest[options.columnNames[i]]);
                }
                else {
                    nodeMap.val(manifest[options.columnNames[i]]);
                }
            }
        }
    }

    async function loadBacks(options, alignDom, clipDom) {
        try {
            var face = 'back';
            var cardPositions = options.cardPositions;
            var svgAttributes = options.svgAttributes;
            var translateOffset = options.translateBackOffset;
            var clip = options.clip;
            var cardsPerSheet = options.cardsPerSheet || 8;
            var nodePredicate = function(node) {
                return (node.$.id == 'CardBack');
            }

            var backDom = await loadSvg(options, 'cardBack', 'CardBack.svg');

            generateTemplate(options, backDom, alignDom, clipDom, cardPositions, nodePredicate, face, clip, svgAttributes, translateOffset, cardsPerSheet);

            return backDom;
        }
        catch (e) {
            console.error(`Could not generate card back dom.`);
            e.messageShown = true;
            console.error(e.message);
            throw e;
        }
    }

    async function loadSvg(options, prop, name) {
        var candidatePath = options[prop];
        if (!/.svg$/.test(candidatePath)) {
            candidatePath = cbu.mergePath(candidatePath, name);
        }
        if (!fs.existsSync(candidatePath)) {
            var testPath = cbu.mergePath(options.cardPath, candidatePath);
            if (fs.existsSync(testPath)) {
                candidatePath = testPath;
            }
            else {
                testPath = cbu.mergePath(options.cardsPath, candidatePath);
                if (fs.existsSync(testPath)) {
                    candidatePath = testPath;
                }
                else {
                    throw `can not find '${prop} using '${options[prop]}'`;
                }
            }
        }
        var bytes = await fs.readFileAsync(cbu.mergePath(candidatePath));
        var dom = null;
        dom = await x2j.parseStringAsync(bytes);

        removeAbsoluteReferences(dom);

        return dom;
    }

    function removeAbsoluteReferences(dom) {
        traverse(dom).forEach(function (node) {
            if (node.$) {
                if (node.$["sodipodi:absref"]) {
                    delete node.$["sodipodi:absref"];
                }
                if (node.$["xlink:href"] && node.$["xlink:href"].slice(0, 3) === '../') {
                    node.$["xlink:href"] = node.$["xlink:href"].slice(3);
                }
            }
        });
    }

    async function loadBlackout(options) {
        return await loadSvg(options, 'cardBlackout', 'CardBlackout.svg');
    }

    async function loadBlank(options) {
        return await loadSvg(options, 'cardBlank', 'CardBlank.svg');
    }
}
