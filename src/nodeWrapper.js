module.exports = {
    NodeWrapper: NodeWrapper
}

var cardBuilderUtilities = require('./cardBuilderUtilities').cardBuilderUtilities;
var _ = require('lodash');

/**
 * 
 * @param {Object} svgNode 
 * @param {string} type 
 * @param {string=} id 
 * @param {function()=} valueGetter 
 * @param {function(value)=} valueSetter 
 *//**
 * @param {string} name
 * @param {Object} svgMap
 * @param {string} type 
 * @param {string=} id 
 * @param {function()=} valueGetter 
 * @param {function(value)=} valueSetter 
 *//**
 * @param {string} name
 * @param {number} ordinal
 * @param {Object} svgMap
 * @param {string} type 
 * @param {string=} id 
 * @param {function()=} valueGetter 
 * @param {function(value)=} valueSetter 
  */
 function NodeWrapper(svgNode, type, id, valueGetter, valueSetter) {
    var _self = this;
    try {
        if (typeof(svgNode) === 'undefined'){
            console.warn(`${id || 'undefined'} node not defined.  check your node names against the svg ids.`);
        }
        if (typeof(svgNode) === 'string'){
            var name = svgNode;
            var offset = 0;
            if (typeof(type) === 'number'){
                name = name + type;
                offset = 1;
            }
            var map = arguments[1 + offset];
            type = arguments[2 + offset];
            id = arguments[3 + offset];
            valueGetter = arguments[4 + offset];
            valueSetter = arguments[5 + offset];
            svgNode = map[name];
            if (!svgNode) {
                console.warn(`${name || 'undefined'} node not defined.  check your node names against the svg ids.`);
            }
        }
    }
    catch (e) {
        console.error(`Critical error locating node.`);
        console.error(e.message);
        e.messageShown = true;
        throw (e);
    }

    this._raw = {
        node: svgNode,
        type: type,
        id: id
    }

    if (svgNode) {
        this._raw.id = this._raw.id || svgNode.$['id']

        if (!type) {
            if ("undefined" !== typeof(svgNode.flowPara)) {
                type = 'flow';
            } 
            else if ("undefined" !== typeof(svgNode.$["xlink:href"])) {
                type = 'image';
            }
            else if ("undefined" !== typeof(svgNode.$.d)) {
                type = 'shape';
                this._raw.valueGetter = function () {
                    var e = new Error('Shapes do not have values to get and set.');
                    e.messageShown = true;
                    console.error(e.message);
                    throw e;
                }
                this._raw.valueSetter = this._raw.valueGetter;
            }
            else if ("undefined" === typeof(svgNode["_"])) {
                var e = ("NodeWrapper can not determine the type of " + svgNode.$['id'] + ' and no inner text node was found.');
                e.messageShown = true;
                console.error(e.message);
                throw e;
            }
        }

        var setGetter = true;
        var setSetter = true;

        if (_.isFunction(valueGetter)) {
            this._raw.valueGetter = valueGetter;
            setGetter = false;
        }
        if (_.isFunction(valueSetter)) {
            this._raw.valueSetter = valueSetter;
            setSetter = false;
        }
        if (setSetter || setGetter) {
            if (type === 'flow'){
                if (setGetter) {
                    setGetter = false;
                    this._raw.valueGetter = function () {
                        try {
                            return _.map(_self._raw.node.flowPara, function(fp) {
                                return fp._;
                            });
                        } 
                        catch (e) {
                            console.error(`Could not get value for ${_self._raw.id}`);
                            e.messageShown = true;
                            console.error(e.message);
                            throw e;
                        }
                    }
                };
                if (setSetter) {
                    setSetter = false;
                    this._raw.valueSetter = function (values) {
                        try {
                            if (values == null)
                            {
                                values = [];
                            }
                            else if (!_.isArray(values)){
                                values = values.toString().split(/[\n\r]+/);
                            }
                            var node = _self._raw.node;

                            var i = 0;
                            var repeater = null;
                            var pseudoRepeater = null;
                            for (var j = 0; j < node.flowPara.length; j++){
                                pseudoRepeater = node.flowPara[j];
                                var fp = NodeWrapper.wrap(node.flowPara[j]);
                                if(fp.unwrap().$["cb-repeater"]){
                                    repeater = fp.unwrap();
                                }
                                if (i < values.length) {
                                    fp.setDisplay(true);
                                    fp.val(values[i++]);
                                }
                                else {
                                    fp.val('');
                                    fp.setDisplay(false);
                                }
                            }
                            if (i < values.length){
                                if (!repeater){
                                    //throw 'no repeater, but still more text.  not cool'
                                    //just use last found
                                    repeater = pseudoRepeater;
                                    if (!repeater){
                                        throw 'no repeater found and no node to use for one'
                                    }
                                }
                                for (;i < values.length; i++){
                                    //make new node
                                    var newPara = traverse(repeater).clone();
                                    //insert node
                                    node.push(newPara);
                                    //wrap node
                                    fp = NodeWrapper.wrap(newPara);
                                    fp.setDisplay(true);
                                    fp.val(values[i]);
                                }
                            }
                        }
                        catch (e) {
                            console.error(`Could not set value for ${_self._raw.id}`);
                            e.messageShown = true;
                            console.error(e.message);
                            throw e;
                        }
                    }
                };

            }


            var defaultPath = '_';
            if (type === 'image') {
                defaultPath = '$[\'xlink:href\']';
            } else if (type === 'flow') {
                defaultPath = 'flowPara[0]._';
            }
            var valuePath = valueGetter || defaultPath;
            if (setGetter) {
                this._raw.valueGetter = function () {
                    try {
                        _.get(_self._raw.node, valuePath);
                    }
                    catch (e) {
                        console.error(`Could not get value for ${_self._raw.id}`);
                        e.messageShown = true;
                        console.error(e.message);
                        throw e;
                    }
                }
            }
            if (setSetter) {
                this._raw.valueSetter = function (value) {
                    try {
                        _.set(_self._raw.node, valuePath, value);
                    }
                    catch (e) {
                        console.error(`Could not set value for ${_self._raw.id}`);
                        e.messageShown = true;
                        console.error(e.message);
                        throw e;
                    }
                }
            }
        }
    }
    else {
        this._raw.valueGetter = function () {
            console.warning(`node is undefined.  check svg ids.`);
            return undefined;
        }
        this._raw.valueSetter = function () {
            console.warning(`node is undefined.  check svg ids.`);
        }
    }
    this._raw.type = this._raw.type || type;
}

//function pair for getting and setting the val of a node, where val is mapped to the actual element's backing attribute
NodeWrapper.prototype.val = function (value) {
    if (arguments.length == 0) {
        return this._raw.valueGetter();
    }
    else {
        this._raw.valueSetter(value);
    }
}

NodeWrapper.prototype.unwrap = function() {
    return this._raw.node;
}

NodeWrapper.prototype.setDisplay = function (value) {
    cardBuilderUtilities.setDisplay(this._raw.node.$, value);
}

/**
 * Wraps an svgNode in a custom NodeWrapper object which normalizes access to the "val" attribute between different node types
 * @param {Object} svgNode 
 * @param {string} type 
 * @param {string} id 
 * @param {string} valuePath 
 */
NodeWrapper.wrap = function (svgNode, type, id, valuePath) {
    return new NodeWrapper(svgNode, type, id, valuePath);
}