'use strict';

// Source code is substantially from these repositories
// https://github.com/mulesoft-labs/yaml-ast-parser
// https://github.com/nodeca/js-yaml

/**
 * Created by kor on 06/05/15.
 */

import YAMLException = require('./exception');

export enum Kind{
    SCALAR          = <any>'SCALAR',
    MAPPING         = <any>'MAPPING',
    MAP             = <any>'MAP',
    SEQ             = <any>'SEQ',
    ANCHOR_REF      = <any>'ANCHOR_REF',
    INCLUDE_REF     = <any>'INCLUDE_REF'
}

export type NodeType = "object" | "array" | "property" | "string" | "number" | "boolean" | "null";
export var NodeType = {
	object: 	"object",
	array:  	"array",
	property:  	"property",
	string:  	"string",
	number:  	"number",
	boolean:  	"boolean",
	null:  		"null",
}

// export interface YAMLDocument {
//     start:number
//     end:number
//     errors:YAMLException[]
// }

export interface YAMLNode {  // extends YAMLDocument
    type?:NodeType       // added
    start:number
    name?:string         // added
    end:number
    parent:YAMLNode
    isKey?:boolean       // added
	isInteger?: boolean  // added
    items?:any           // items
    properties?:any

    errors:YAMLException[]
    kind:Kind
    anchorId?:string
    key?:any
    valueNative?:any
    buffer?:string
    value?:any
}

export interface YAMLAnchorReference extends YAMLNode{
    referencesAnchor:string
    value:YAMLNode
}
export interface YAMLScalar extends YAMLNode{
    value?:string
    doubleQuoted?:boolean
    plainScalar?:boolean
    buffer?: string
}

export interface YAMLMapping extends YAMLNode{
    key:YAMLScalar
    value:YAMLNode
}
export interface YAMLSequence extends YAMLNode{
    items:YAMLNode[]
}
export interface YamlMap extends YAMLNode{
    properties:YAMLMapping[]
}
export function newMapping(key:YAMLScalar,value:YAMLNode):YAMLMapping{
    var end = (value ? value.end : key.end + 1); //FIXME.workaround, end should be defied by position of ':'
    //console.log('key: ' + key.value + ' ' + key.startPosition + '..' + key.endPosition + ' ' + value + ' end: ' + end);

    // value.name = key.name = key.buffer;

    var node: YAMLMapping = {
      type: 'property',
      name: null,
      start: key.start,
      end: end,
      parent: null,
      kind: Kind.MAPPING,
      key: key,
      value: value,
      errors: []
  };
  return node
}
export function newAnchorRef(key:string,start:number,end:number,value:YAMLNode): YAMLAnchorReference {
    return {
        type: 'string',
        name: key,
        start:start,
        end:end,
        parent:null,
        value:value,
        referencesAnchor:key,
        kind:Kind.ANCHOR_REF,
        errors:[]
    }
}
export function newScalar(v:string=""):YAMLScalar{
    return {
        type: undefined,
        name: v,
        start:-1,
        end:-1,
        parent:null,
        isKey: undefined,
        kind:Kind.SCALAR,
        doubleQuoted:false,
        buffer: v,
        errors:[]
    }
}
export function newItems():YAMLSequence{
    return {
        type: 'array',
        name: null,
        start:-1,
        end:-1,
        parent:null,
        kind:Kind.SEQ,
        items:[],
        errors:[]
    }
}
export function newSeq():YAMLSequence{
    return newItems();
}
export function newMap(properties?: YAMLMapping[]): YamlMap {
    return {
        type: 'object',
        name: null,
        start:-1,
        end:-1,
        parent:null,
        kind:Kind.MAP,
        properties: properties ? properties : [],
        errors:[]
    }
}
