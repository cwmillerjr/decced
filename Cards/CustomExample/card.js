module.exports = {
    Card: Card
}

var _ = require('lodash');
var srcPath = '../../src/';
var CardBase = require(srcPath + 'CardBase').CardBase;
var cbu = require(srcPath + 'cardBuilderUtilities').cardBuilderUtilities;
var NW = require(srcPath + 'nodeWrapper').NodeWrapper;

function manifestMapper (columns, options) {
    //Here we map each element in the row from the manifest
    //to a manifest object as a hash.
    var currentColumn = 0;
    columns = columns || [];
    var cardManifest = {};
    cardManifest.name = columns[currentColumn++] || '';
    cardManifest.points = columns[currentColumn++] || '';
    cardManifest.color = columns[currentColumn++] || '';
    cardManifest.hero = columns[currentColumn++] || '';
    var pips = columns[currentColumn++] || '';
    pips = pips.toString();
    //Here we create an array of booleans we will use to turn
    //on and off the pips.
    //The format of the field is a set of numbers one through five.
    //If a number exists in this set, it will be set to true.
    cardManifest.pips = [false, false, false, false, false];
    //Check if there is a 1 in the list, and if so, set pip 1 to true.
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
    return cardManifest;
}

function nodeMapper (cardIndex, svgMap, options) {
    return {
        //This creates a hash of svg NodeWrappers which give
        //you extended and uniform ways of manipulating the
        //nodes in the graph and uniform way of manipulating
        //the cards.  You only need to know the property is "Name"
        //not that the node in the svg is "Name3" for that card.
        //Giving the type of svg node is not necessary.
        Name: NW.wrap('Name', cardIndex, svgMap, 'flow'),
        Color: NW.wrap('Color', cardIndex, svgMap, 'flow'),
        Points: NW.wrap('Points', cardIndex, svgMap, 'flow'),
        Hero: NW.wrap('Hero', cardIndex, svgMap, 'image'),
        //Here we use a loop to create an array of pip node wrappers.
        //This is just easier to work with than putting them all in the
        //flat hash, but it is totally acceptable to put them in the flat
        //hash.
        Pips: _.map(_.range(0,5), function (i){
            //Here we use the overload which passes in the complete name
            //of the node to look for.
            return NW.wrap('Pip' + cardIndex + (i + 1), svgMap, 'image');
        })
    }
}

//This method is called for each manifest line and therefore each
// card rendered
function svgMapper (manifest, cardIndex, svgMap, options) {
    //We create a node wrapper object map here.
    var map = options.nodeMapper(cardIndex, svgMap, options);
    //Set the values from the manifest file.
    map.Name.val(manifest.name);
    map.Color.val(manifest.color);
    map.Points.val(manifest.points);
    //Here we loop through the pips in the map
    //and apply the value from the manifest to show 
    //or hide them.
    for (var i = 0; i < 5; i++) {
        var rmap = map.Pips[i];
        rmap.setDisplay(manifest.pips[i])
    }
    //Next we probe for the image and set the value
    //if it is true, or hide it if it is false.
    var val = this.probeImage(manifest.hero, options);
    if (val){
        map.Hero.val(val);
        map.Hero.setDisplay(true);
    }
    else {
        map.Hero.setDisplay(false);
    }
}

//Boilderplate set up
function Card(options) {
    CardBase.call(this, _.assign({
            manifestMapper: manifestMapper,
            nodeMapper: nodeMapper,
            svgMapper: svgMapper
        }, options))
}
