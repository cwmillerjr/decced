module.exports = {
    Card: Card
}

var _ = require('lodash');
var srcPath = '../../src/';
var CardBase = require(srcPath + 'CardBase').CardBase;
var cbu = require(srcPath + 'cardBuilderUtilities').cardBuilderUtilities;
var NW = require(srcPath + 'nodeWrapper').NodeWrapper;
var pipMap = [
    [], //blank
    [9], //A
    [2,16], //2
    [2,9,16], //3
    [1,3,15,17], //4
    [1,3,9,15,17], //5
    [1,3,8,10,15,17], //6
    [1,3,4,8,10,15,17], //7
    [1,3,4,8,10,14,15,17], //8
    [1,3,5,7,9,11,13,15,17], //9
    [1,3,4,5,7,11,13,14,15,17], //10
    [], //J
    [], //Q
    [] //K
]

function manifestMapper (columns, options) {
    //Here we map each element in the row from the manifest
    //to a manifest object as a hash.
    var currentColumn = 0;
    columns = columns || [];
    var cardManifest = {};
    cardManifest.suit = columns[currentColumn++] || '';
    //Change the manifest value into the Glyph id we'll be using throughout.
    cardManifest.suit = '#' + cardManifest.suit.substr(0,1).toUpperCase() + cardManifest.suit.substr(1).toLowerCase() + "Glyph";
    cardManifest.rank = columns[currentColumn++] || '';
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
        RankUp: NW.wrap('RankUp', cardIndex, svgMap, 'flow'),
        RankDown: NW.wrap('RankDown', cardIndex, svgMap, 'flow'),
        SuitUp: NW.wrap('SuitUp', cardIndex, svgMap, 'image'),
        SuitDown: NW.wrap('SuitDown', cardIndex, svgMap, 'image'),
        //Here we use a loop to create an array of pip node wrappers.
        //This is just easier to work with than putting them all in the
        //flat hash, but it is totally acceptable to put them in the flat
        //hash.
        Pips: _.map(_.range(0,17), function (i){
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
    var rankText = manifest.rank;
    if (rankText == 1){
        rankText = "A";
    }
    map.RankUp.val(rankText);
    map.RankDown.val(rankText);
    map.SuitUp.val(manifest.suit);
    map.SuitDown.val(manifest.suit);
    //Here we loop through the pips in the map
    //and apply the value from the manifest to show 
    //or hide them.
    for (var i = 0; i < 17; i++) {
        var on = false;
        //if it's in our map above for this rank, turn it on, if not, turn it off.
        if (pipMap[manifest.rank].indexOf(i+1) >= 0){
            on = true;
        }
        var rmap = map.Pips[i];
        rmap.setDisplay(on)
        rmap.val(manifest.suit);
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
