'use strict';

// For compairing AST output of JSON and YAML parsers.
// This was used to bend the content from yaml-ast-parser/js-yaml into local AST

// For best results, build project before running tool :)

var fs = require('fs');
var path = require('path');

var jsonParser = require('../../client/server/json/jsonParser');
var yamlParser = require('../../client/server/yaml/yamlParser');

var filteredJsonProps = [
  'colonOffset'
];

var trimJson = function (key, val) {
    if (key === 'parent') {
        if (val === undefined) return undefined;
        if (val == null) return null;

        return "{" + Object.keys(val).length + "}";
    }

    if (filteredJsonProps.indexOf(key) > -1) {
        return undefined;
    }

    return val;
}

var filteredYamlProps = [
  'kind',
  'errors',
  'doubleQuoted',
  'plainScalar'
];

var trimYaml = function (key, val) {
    if (key === 'parent') {
        if (val === undefined) return undefined;
        if (val == null) return null;

        return "{" + Object.keys(val).length + "}";
        // return "[ " + Object.keys(val).join(', ').toString() + " ]";
    }

    if (filteredYamlProps.indexOf(key) > -1) {
        return undefined;
    }

    return val;
}

var yamlText = fs.readFileSync('./tools/in/petstore.yaml', 'utf8');
var jsonText = fs.readFileSync('./tools/in/petstore.json', 'utf8');

// var yamlModel = yamlParser.load(yamlText, {});
// fs.writeFileSync('./tests/modelYaml.json', JSON.stringify(yamlModel, trimYaml, 2));

var jsonDocument = jsonParser.parse(jsonText);
fs.writeFileSync('./tools/out/petstoreJsonAST.json', JSON.stringify(jsonDocument.root, trimJson, 2));

var yamlDocument = yamlParser.parse(yamlText, {});
fs.writeFileSync('./tools/out/petstoreYamlAST.json', JSON.stringify(yamlDocument.root, trimJson, 2));

