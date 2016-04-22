'use strict';

// Source code is substantially from these repositories
// https://github.com/mulesoft-labs/yaml-ast-parser
// https://github.com/nodeca/js-yaml

import Mark = require("./mark")

class YAMLException {

  message:string
  reason:string
  name:string
  mark:Mark

  constructor(reason:string, mark:Mark=null) {
    this.name = 'YAMLException';
    this.reason = reason;
    this.mark = mark;
    this.message = this.toString(false);
  }

  toString(compact:boolean=false) {
    var result;

    result = 'yaml: ' + (this.reason || '(unknown reason)');

    if (!compact && this.mark) {
      result += ' ' + this.mark.toString();
    }

    return result;

  }
}
export = YAMLException