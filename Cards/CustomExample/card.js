module.exports = {
    Card: Card
}

var _ = require('lodash');
var srcPath = '../../src/';
var CardBase = require(srcPath + 'CardBase').CardBase;
var cbu = require(srcPath + 'cardBuilderUtilities').cardBuilderUtilities;
var NW = require(srcPath + 'nodeWrapper').NodeWrapper;

function manifestMapper (columns, options) {
    options = options || this;
    var currentColumn = 0;
    columns = columns || [];
    var cardManifest = {};
    cardManifest.name = columns[currentColumn++] || '';
    cardManifest.points = columns[currentColumn++] || '';
    cardManifest.color = columns[currentColumn++] || '';
    cardManifest.hero = columns[currentColumn++] || '';
    var pips = columns[currentColumn++] || '';
    pips = pips.toString();
    cardManifest.pips = [false, false, false, false, false];
    if (pips.indexOf('1') >= 0){
        cardManifest.pips[0] = true;
    }
    if (pips.indexOf('2') >= 0){
        cardManifest.pips[1] = true;
    }
    if (pips.indexOf('3') >= 0){
        cardManifest.pips[2] = true;
    }
    if (pips.indexOf('4') >= 0){
        cardManifest.pips[3] = true;
    }
    if (pips.indexOf('5') >= 0){
        cardManifest.pips[4] = true;
    }

    if (cardManifest.hero && !cardManifest.hero.includes('.')) {
       cardManifest.hero = cbu.mergePath('../Cards/' + options.cardName + '/Assets/', cardManifest.hero + '.png');
    }
    return cardManifest;
}

function nodeMapper (cardIndex, svgMap, options) {
    return {
        Name: NW.wrap('Name', cardIndex, svgMap, 'flow'),
        Color: NW.wrap('Color', cardIndex, svgMap, 'flow'),
        Points: NW.wrap('Points', cardIndex, svgMap, 'flow'),
        Hero: NW.wrap('Hero', cardIndex, svgMap, 'image'),
        Pips: _.map(_.range(0,5), function (i){
            return NW.wrap('Pip' + cardIndex + (i + 1), svgMap, 'image');
        })
    }
}

function svgMapper (manifest, cardIndex, svgMap, options) {
    options = options || this;
    var map = options.nodeMapper(cardIndex, svgMap, options);
    map.Name.val(manifest.name);
    map.Color.val(manifest.color);
    map.Points.val(manifest.points);
    for (var i = 0; i < 5; i++) {
        var rmap = map.Pips[i];
        rmap.setDisplay(manifest.pips[i])
    }
    if (manifest.hero){
        map.Hero.val(manifest.hero);
        map.Hero.setDisplay(true);
    }
    else {
        map.Hero.setDisplay(false);
    }
}

function Card(options) {
    CardBase.call(this, _.assign({
            manifestMapper: manifestMapper,
            nodeMapper: nodeMapper,
            svgMapper: svgMapper
        }, options))
}
