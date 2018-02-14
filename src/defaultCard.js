module.exports = {
    Card: Card
}

var srcPath = './';
var _ = require('lodash');
var CardBase = require(srcPath + 'CardBase').CardBase;

function Card(options) {
    CardBase.call(this, _.assign({
        }, options))
}
