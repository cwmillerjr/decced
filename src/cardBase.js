module.exports = {
    CardBase: CardBase
}

var x2j = require('xml2js');
var fs = require('fs');
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

    this.Name = function (val){
        if (arguments.length > 0){
            _self.options.cardName = val;
        }
        else {
            return _self.options.cardName;
        }
    }

    this.ManifestLoader = function (manifest, format) {
        var parsedRows = cbu.parseManifest(manifest, format, _self.options.minManifestColumns);
        if (parsedRows.length > 0 && parsedRows[0].length > 0 && parsedRows[0][0][0] === '$'){
            _self.options.columnNames = parsedRows[0];
            _self.options.columnNames[0] = _self.options.columnNames[0].substr(1);
            parsedRows.splice(0,1);
        }
        if (parsedRows.length > 0 && parsedRows[0].length > 0 && parsedRows[0][0][0] === '^'){
            _self.options.defaultManifest = parsedRows[0];
            _self.options.defaultManifest[0] = _self.options.defaultManifest[0].substr(1);
            parsedRows.splice(0,1);
        }
        var mappedObjects = _.map(parsedRows, function (parsedRow) {
            var mappedObject = _self.options.manifestMapper(parsedRow, _self.options);
            return mappedObject;
        });
        return mappedObjects;
    }

    this.Generate = function (generationData, svgTemplate, manifest) {

        generationData = generationData || { totalSheetCount: -1, files: [] };
        var renderPath = generationData.renderPath || _self.options.renderPath;
        //normalize path
        renderPath = cbu.mergePath(renderPath);
        if (!fs.existsSync(renderPath)){
            fs.mkdirSync(renderPath);
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
            svgTemplate = fs.readFileSync(svgTemplate);
        }

        //divine the manifest to use
        var format = 'tab';
        if (!manifest) {
            if (_.endsWith(_self.options.manifestPath, 'xlsx')) {
                manifest = fs.readFileSync(_self.options.manifestPath);
                format = 'xlsx';
            }
            else {
                manifest = fs.readFileSync(_self.options.manifestPath, { encoding: 'utf8' });
            }
        }

        //parse the manifest into manifest objects
        manifest = _self.ManifestLoader(manifest, format);

        //parse the svg into xml for preprocessing
        x2j.parseString(svgTemplate, function (e, svgDom) {
            removeAbsoluteReferences(svgDom);
            var data = { manifest: manifest, totalSheetCount : totalSheetCount, self : _self, renderPath : renderPath, generationData : generationData };
            generateCardSheets(e, svgDom, data);
            totalSheetCount = data.totalSheetCount;
        });
        generationData.totalSheetCount = totalSheetCount;
    }

    function generateCardSheets (e, svgDom, data)
    {
        var manifest = data.manifest;
        var totalSheetCount = data.totalSheetCount;
        var _self = data.self;
        var hasCards = false;
        var cardTemplateNode;
        var cardTemplateNodeParent;
        var options = _self.options;
        var renderPath =  data.renderPath;
        var generationData = data.generationData;

        setCropMarks (svgDom, 'front', options);

        //find the card template element in the svg file
        traverse(svgDom).forEach(function (node) {
            if (node.$ && node.$.id) {
                if (node.$.id == 'Card_T' || node.$.id === 'Card$') {
                    cardTemplateNode = node;
                    cardTemplateNodeParent = this.parent.node;
                }
                //check to see if there's a card body defined that has already been processed before getting here
                else if (/^Card[0-8]$/.test(node.$.id)) {
                    hasCards = true;
                    return false;
                }
            }
        });

        if (!hasCards) {

            //root positions to place the cloned cards
            var cardPositions = 
                options.cardPositions || 
                {
                    x: [
                        0,
                        63.5,
                        127,
                        190.5
                    ],
                    y:[
                        -108,
                        -196.85
                    ]
                };

            //figure out if the svg needs positions to be offset
            var cardPositionTranslations = [];
            var xOff = -63.5;
            if (options.translateOffset && options.translateOffset.x) {
                xOff = options.translateOffset.x;
            }
            var yOff = 0;
            if (options.translateOffset && options.translateOffset.y) {
                yOff = options.translateOffset.y;
            }

            //create card position (svg "translate" attributes) array using the root and any offsets
            for (var x=0;x<cardPositions.x.length; x++){
                for (var y=0;y<cardPositions.y.length; y++){
                    var xPos = cardPositions.x[x] + xOff;
                    var yPos = cardPositions.y[y] + yOff;
                    cardPositionTranslations.push(`translate(${xPos},${yPos})`);
                }
            }

            //clone the template for each position and insert it into the svg.
            cardPositionTranslations.forEach(function (translate, index) {
                var aCard = traverse(cardTemplateNode).clone();
                aCard.$.transform = translate;
                traverse(aCard).forEach(function (node) {
                    if (node.$ && node.$.id) {
                        node.$.id = node.$.id.replace('_T', index + 1).replace('$', index + 1);
                    }
                });
                cardTemplateNodeParent.push(aCard);
            });
        }

        //get a dictionary of elements by their ids.
        var svgMap = cbu.mapSvg(svgDom);

        //delete existing rendered svg pages.
        cbu.purgeSheets(options.cardName, renderPath);

        var xmlBuilder = new x2j.Builder({renderOpts: {pretty:true}});

        var cardSheet = 1;
        var cardIndex = 1;
        var countPrefix = '';

        //load the card back svg file to render after each card sheet for printing 2 sided
        var backs = null; 
        if (options.backs) {
            var svgDom2 = loadBacks(options);
            setCropMarks (svgDom2, 'back', options);
            backs =  xmlBuilder.buildObject(svgDom2);
        }

        var blackout = null;
        if (options.blackout){
            var svgDom2 = loadBlackout(options);
            setCropMarks (svgDom2, 'blackout', options, false);
            blackout =  xmlBuilder.buildObject(svgDom2);
        }

        var blank = null;
        if (options.blackout && options.backs){
            var svgDom2 = loadBlank(options);
            setCropMarks (svgDom2, 'blank', options, false);
            blank =  xmlBuilder.buildObject(svgDom2);
        }

        var docs = [null, blackout, backs, blank];

        var fileName;
        var sheetPath;

        var take = options.take;
        var skip = options.skip || 0;

        var startAt = skip + 1;
        var stopAt = take;
        if (take) {
            stopAt = startAt + take
        }




        manifest.forEach(function (manifest) {
        
                //map the cards on the page
                options.svgMapper(manifest, cardIndex, svgMap, options);
                cardIndex++;
                //render a page once you've rendered the number of cards on the page (currently only 8 is available)
                if (cardIndex > 8) {
                    var svgDocument = xmlBuilder.buildObject(svgDom);
                    
                    if (totalSheetCount >= 0) {
                        totalSheetCount++;
                    }

                    docs[0] = svgDocument;
                    if (cardSheet >= startAt && (!stopAt || cardSheet < stopAt)){
                        saveSheets(totalSheetCount, cardSheet, renderPath, generationData, docs);
                    }
                    cardSheet++;
                    cardIndex = 1;
            }
            
        });
        if (options.blankCards){
            var r = /^([0-9]+)(s|c)?$/;
            var m = options.blankCards.match(r);
            var x = 0;
            if (m[2] === 's'){
                x = 8 * m[1];
                if (cardIndex > 1 && cardIndex < 9){
                    x += (9 - cardIndex);
                }
            }
            else {
                x = m[1] * 1;
            }
            var empty = options.manifestMapper();
            for (;x>0;x--) {
                //map the cards on the page
                options.svgMapper(empty, cardIndex, svgMap, options);
                cardIndex++;
                //render a page once you've rendered the number of cards on the page (currently only 8 is available)
                if (cardIndex > 8) {
                    var svgDocument = xmlBuilder.buildObject(svgDom);
                    
                    if (totalSheetCount >= 0) {
                        totalSheetCount++;
                    }

                    docs[0] = svgDocument;
                    if (cardSheet >= startAt && (!stopAt || cardSheet < stopAt)){
                        saveSheets(totalSheetCount, cardSheet, renderPath, generationData, docs);
                    }

                    cardSheet++;
                    cardIndex = 1;
                }
            };

        }
        //if you have a partial sheet, pad out the remaining unfilled positions (otherwise they will render the previous page's cards) and save the partial sheet
        if (cardIndex != 1 && cardIndex < 9) {
            var empty = options.manifestMapper();
            while (cardIndex < 9) {
                //what's the difference?
                if (svgMap['Card' + cardIndex]) {
                    //blank card
                    cbu.setDisplay(svgMap['Card' + cardIndex].$, false);
                }
                else {
                    options.svgMapper(empty, cardIndex, svgMap, options);
                }
                cardIndex++;
            }
            var svgDocument = xmlBuilder.buildObject(svgDom);
            if (totalSheetCount >= 0) {
                totalSheetCount++;
            }

            docs[0] = svgDocument;
            if (cardSheet >= startAt && (!stopAt || cardSheet < stopAt)) {
                saveSheets(totalSheetCount, cardSheet, renderPath, generationData, docs);
            }
            

            cardSheet++;
            cardIndex = 1;
        }
        data.totalSheetCount = totalSheetCount;
    }

    function setCropMarks (dom, cropMarkKey, options, keepStandardAlignmentHoles) {
        if (typeof(keepStandardAlignmentHoles) === 'undefined'){
            keepStandardAlignmentHoles = true;
        }
        if (! new RegExp(',' + cropMarkKey + ',','i').test(`,${options.cropMarks},`)){
            traverse(dom).forEach(function (node) {
                if (this.parent && this.parent.node && this.parent.node.$ && this.parent.node.$.id == 'Alignment') {
                    _.forEach(this.parent.node.g, function(alignmentNode){
                        cbu.setDisplay(alignmentNode.$, alignmentNode.$.id == 'StandardAlignmentHoles' && keepStandardAlignmentHoles);
                    });
                }
            });
        }
    }

    function saveSheet(count, cardSheet, renderPath, generationData, cardSheetOrdinal, svgDocument) {
        var prefix = '0000' + count.toString();
        prefix = prefix.substr(prefix.length - 4);
        var fileName = prefix + '.' + cardSheetOrdinal + '_' + _self.options.cardName + '_Sheet' + cardSheet + '.svg';
        var sheetPath = cbu.mergePath(renderPath, fileName);
        console.log('      ' + fileName);
        generationData.files.push({
            fileName: fileName,
            cardName: _self.options.cardName
        });
        fs.writeFileSync(sheetPath, svgDocument);
    }

    function saveSheets(count, cardSheet, renderPath, generationData, svgDocument1, svgDocument2, svgDocument3) {
        var docs;
        if (_.isArray(svgDocument1)){
            docs = svgDocument1;
        }
        else {
            docs = arguments.slice(4);
        }

        var c = 0;
        for (var i = 0 ;i < docs.length;i++) {
            if (docs[i]){
                saveSheet(count, cardSheet, renderPath, generationData, c++, docs[i]);
            }
        }
    }

    function parseOptions(options) {
        if (!options.rootPath){
            options.rootPath = '../';
        }
        if (!options.cardsPath){
            options.cardsPath = cbu.mergePath(options.rootPath,'Cards');
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
        if (!options.manifestsPath){
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

        if (!options.manifestMapper){
            options.manifestMapper = defaultManifestMapper;
        }
    
        if (!options.svgMapper){
            options.svgMapper = defaultSvgMapper;
        }

        return _.assign({},
            {
                renderPath: '../Renders/',
            },
            options || {});
    }

    function defaultManifestMapper (columns, options) {
        var currentColumn = 0;
        columns = columns || [];
        var cardManifest = {};
        if (typeof(columns) === 'undefined' || columns === null || columns.length == 0){
            options = _self.options;
            for (var i = 0; i < options.columnNames.length; i++){
                cardManifest[options.columnNames[i]] = null;
            }
            _.assign(cardManifest, options.defaultManifest || {});
        }
        else if (options.columnNames){
            for (var i = 0; i < options.columnNames.length; i++){
                cardManifest[options.columnNames[i]] = columns[i];
            }
        }
        else {
            cardManifest = columns;
        }
        return cardManifest;
    }

    function defaultNodeMapper (cardIndex, svgMap, options) {
        var map = {}
        if (options.columnNames){
            for (var i = 0; i < options.columnNames.length; i++){
                map[options.columnNames[i]] = NW.wrap(svgMap[options.columnNames[i] + cardIndex]);
            }
        }
        return map;
    }

    function defaultSvgMapper (manifest, cardIndex, svgMap, options) {
        var map = defaultNodeMapper(cardIndex, svgMap, options);
        if (options.columnNames){
            for (var i = 0; i < options.columnNames.length; i++){
                var nodeMap = map[options.columnNames[i]];
                if (nodeMap._raw.type === 'image'){
                    var val = manifest[options.columnNames[i]];
                    if (!val) {
                        val = '';
                    } else if (val.indexOf('/') < 0) {
                        if (val.indexOf('.' < 0)){
                            val = val + '.png';
                        }
                        val = cbu.probePaths(val, options.assetPath, options.cardPath, cbu.mergePath(options.rootPath, 'Assets'));
                    }
                    nodeMap.val(val);
                    nodeMap.setDisplay(!!manifest[options.columnNames[i]]);
                }
                else {
                    nodeMap.val(manifest[options.columnNames[i]]);
                }
            }
        }
    }

    function loadBacks (options) {
        return loadSvg(options, 'cardBack', 'CardBack.svg');
    }

    function loadSvg (options, prop, name) {
        var candidatePath = options[prop];
        if (!/.svg$/.test(candidatePath)){
            candidatePath = cbu.mergePath(candidatePath, name);
        }
        if (!fs.existsSync(candidatePath)){
            var testPath = cbu.mergePath(options.cardPath, candidatePath);
            if (fs.existsSync(testPath)){
                candidatePath = testPath;
            }
            else {
                testPath = cbu.mergePath(options.cardsPath, candidatePath);
                if (fs.existsSync(testPath)){
                    candidatePath = testPath;
                }
                else {
                    throw `can not find '${prop} using '${options[prop]}'`;
                }
            }
        }
        var bytes = fs.readFileSync(cbu.mergePath(candidatePath));
        var dom = null;
        x2j.parseString(bytes, function (e, svgDom) {
            dom = svgDom;
        });

        removeAbsoluteReferences(dom);

        return dom;
    }

    function removeAbsoluteReferences(dom){
        traverse(dom).forEach(function (node) {
            if (node.$) {
                if (node.$["sodipodi:absref"]){
                    delete node.$["sodipodi:absref"];
                }
                if (node.$["xlink:href"] && node.$["xlink:href"].slice(0, 3) === '../')
                {
                    node.$["xlink:href"] = node.$["xlink:href"].slice(3);
                }
            }
        }); 
    }

    function loadBlackout (options) {
        return loadSvg(options, 'cardBlackout', 'CardBlackout.svg');
    }

    function loadBlank (options) {
        return loadSvg(options, 'cardBlank', 'CardBlank.svg');
    }
}