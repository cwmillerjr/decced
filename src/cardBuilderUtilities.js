var fs = require('fs');
var _ = require('lodash');
var traverse = require('traverse');
var xlsx = require('node-xlsx');

/**
 * @typedef {Object} CardBuilderUtilities
 */
/** @type {CardBuilderUtilities} */
function CardBuilderUtilities() {
    var _self = this;
    var displayNoneRegex = /;?display:\s*none;?/gi;

    /**
     * Applies limited markdown to svg conversion BROKEN
     * @param {string} text 
     */
    this.markdown = function (text) {
        var italics = /_([^_]*)_/g;
        var bold = /\*([^\*]*)\*/g;

        text = italics[Symbol.replace](text, function (match, submatch){
            //return '<svg:fontSpan style="font-style:italic">' + submatch + '</svg:fontSpan>';
            return submatch;
        });
        text = bold[Symbol.replace](text, function (match, submatch){
            //return '<svg:fontSpan style="font-weight:bold">' + submatch + '</svg:fontSpan>';
            return submatch;
        });
        return text;
    }

    /**
     * Sets the display attribute on an svg element.  AttributeHash is the "$" property of an svg node.
     * @param {Object} attributeHash 
     * @param {bool} display 
     */
    this.setDisplay=  function (attributeHash, display) {
        if (!!display) {
            if (attributeHash['style'] && displayNoneRegex.test(attributeHash['style'])) {
                attributeHash['style'] = attributeHash['style'].replace(displayNoneRegex, '');
            }
            if (!attributeHash['style'] || attributeHash['style'].replace(';', '') == '') {
                delete attributeHash['style'];
            }
        }
        else {
            var scrubbedStyle = (attributeHash['style'] || '').replace(displayNoneRegex, '');
            if (scrubbedStyle.trim()) {
                attributeHash['style'] = scrubbedStyle + ';display: none;';
            }
            else {
                attributeHash['style'] = 'display: none;';
            }
        }
    }

    /**
     * Delete files starting containing the card name, excluding rendered pdfs.
     * @param {string} cardName 
     * @param {string} renderPath 
     */
    this.purgeSheets= function (cardName, renderPath) {
        var regex = new RegExp("([^a-z]+_)?" + cardName + "_.*\\.svg", 'gi');
        var files = fs.readdirSync(renderPath);
        var existingFiles = _.filter(files, function (file) {
            //wtf... returns false if the semicolon is there and true if it isn't, but still won't work either way for the filter...
            //regex.test(file);
            var t = file.substr(-4,4).toLocaleLowerCase();
            return file != file.replace(cardName,'') && t != '.pdf';
        });

        existingFiles.forEach(function (file) {
            fs.unlinkSync(_self.mergePath(renderPath, file));
        });
    }

/**
 * Deletes all files with the given suffixes, allowing a callback after the file has be deleted.
 * @param {string} renderPath 
 * @param {string} suffix 
 * @param {callback} callback 
 */
    this.purgeFiles= function (renderPath, suffix, callback) {
        var suffixes;
        if (_.isArray(suffix)){
            suffixes = suffix;
        }
        else {
            suffixes = [suffix];
        }
        var files = fs.readdirSync(renderPath);
        var existingFiles = _.filter(files, function (file) {
            return _.some(suffixes, function(sfx) {
                 return file.endsWith('.'+sfx);
                });
        });

        existingFiles.forEach(function (file) {
            fs.unlinkSync(_self.mergePath(renderPath, file));
            if (callback){
                callback(file);
            }
        });
    }

    /**
     * Creates a hash of svg elements by their element id.
     * @param {SvgDom} svgDom 
     */
    this.mapSvg= function (svgDom) {
        return _.keyBy(
            _.filter(traverse.nodes(svgDom), function (node) { return node.$ && node.$.id; }),
            function (node) {
                return node.$.id;
            }
        );
    }

    /**
     * Split the provided string on breaks and then remove all comments (begining with # until end of line) and all blank lines.
     * @param {string} manifestText 
     */
    this.parseLines= function (manifestText) {
        var lines = manifestText.split(/[\r\n]+/);
        lines = _.map(lines, function (l) { return l.replace(/#.*/, ''); });
        lines = _.filter(lines, function (l) { return !!l });
        return lines;
    }

    /**
     * Splits a string on tab and skip any string with less than min number of columns
     * @param {string[]} lines 
     * @param {number} minColumns 
     */
    this.parseColumns= function (lines, minColumns) {
        var columns = _.map(lines, function (l) { return _.map(l.split('\t'), function (t) { return t.trim(); }) });
        if (minColumns) {
            columns = _.filter(columns, function (cs) { return cs.length >= minColumns });
        }
        return columns;
    }

    /**
     * Parses a manifest file using the manifest format to pick which parser to use
     * @param {byte[]} manifest 
     * @param {string} manifestFormat 
     * @param {number} minColumns 
     *//** Parses a manifest file using the manifest format to pick which parser to use.  Format will default to 'tab'
     * @param {byte[]} manifest 
     * @param {number} minColumns 
     */
    this.parseManifest= function (manifest, manifestFormat, minColumns) {
        if (typeof manifestFormat !== 'string'){
            minColumns = manifestFormat;
            manifestFormat = 'tab';
        }
        switch (manifestFormat){
            case 'xlsx':
                return parseXlsxManifest(manifest, minColumns);
            default:
                return parseTabManifest(manifest, minColumns);
        }
    }

    //parse an Excel (xlsx) file
    function parseXlsxManifest (manifestXlsx, minColumns) {
        var wb = xlsx.parse(manifestXlsx);
        var sheet = wb[0];
        var result = sheet.data;
        for (var r = result.length - 1; r >= 0; r--){
            var empty = true;
            var killAt = -1;
            for (var c = 0; c < result[r].length; c++){
                result[r][c] = result[r][c] || '';
                if (/#/gi.test(result[r][c])) {
                    killAt = c+1;
                    result[r][c] = result[r][c].replace(/#.*/gi, '');
                }
                if (result[r][c] != ''){
                    empty = false;
                }
                if (killAt > -1){
                    break;
                }
            }
            if (empty){
                result.splice(r,1);
            }
            else {
                 if (killAt > -1) {
                    result[r].splice(killAt);
                }
            }
        }
        return result;
    }

    //parse a tab file
    function parseTabManifest (manifestText, minColumns) {
        var lines = _self.parseLines(manifestText);
        var columns = _self.parseColumns(lines, minColumns);
        return columns;
    }

    // /**
    //  * Wraps an svgNode in a custom NodeWrapper object which normalizes access to the "val" attribute between different node types
    //  * @param {Object} svgNode 
    //  * @param {string} type 
    //  * @param {string} id 
    //  * @param {string} valuePath 
    //  */
    // this.wrap= function (svgNode, type, id, valuePath) {
    //     return new NodeWrapper(svgNode, type, id, valuePath);
    // }

    /**
     * Take multiple path fragments and join them; normalizing the path separater in the process
     * @param {string[]} fragments 
     */
    this.mergePath= function (fragments) {
        if (!_.isArray(fragments)) {
            fragments = _.toArray(arguments);
        }
        fragments = _.map(fragments, function (fragment, position) {
            fragment = _.replace(fragment, '\\', '/');
            if (fragments.length == 1) {
                return fragment;
            }
            else if (position == 0) {
                return _.trimEnd(fragment, '/');
            }
            else if (position == fragments.length - 1) {
                return _.trimStart(fragment, '/');
            }
            else {
                return _.trim(fragment, '/');
            }
        });
        return _.join(fragments, '/');
    }

    /**
     * Find the next filename to use
     * @param {string} path 
     * @param {string} fileName 
     */
    this.nextFileName = function (path, fileName){
        var fp = /^(.*?)(\.[^.]*)?$/;
        var m = fileName.match(fp);

        var newFile = fileName;
        for (var i = 1; fs.existsSync(this.mergePath(path,newFile)); i++) {
            newFile = `${m[1] || ''}(${i})${m[2] || ''}`;
        }
        return newFile;
    }

    /**
     * Probe paths for filename, returning the first match.
     */
    this.probePaths = function(fileName, path1, path2, path3) {
        var match = null;
        for (var i = 1; i < arguments.length; i++){
            var probe = this.mergePath(arguments[i], fileName);
            if (fs.existsSync(probe)){
                match = probe;
                break;
            }
        }
        return match;
    }
}

var cardBuilderUtilities = new CardBuilderUtilities();


module.exports = {
    /**
     * @type CardBuilderUtilities
     */
    cardBuilderUtilities: cardBuilderUtilities
}