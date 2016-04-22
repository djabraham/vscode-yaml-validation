'use strict';

// Source code is substantially from these repositories
// https://github.com/Microsoft/vscode/tree/master/extensions/json

import JsonSchema = require('../json/jsonSchema');
import { JSONLocation } from '../json/jsonLocation';

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

import YamlCommon = require('./common');
import YamlLoader = require('./loader');
import YamlInterface = require('./interface');

import DEFAULT_SAFE_SCHEMA = require('./schema/default_safe');
import DEFAULT_FULL_SCHEMA = require('./schema/default_full');

export interface IRange {
	start: number;
	end: number;
}

export interface IError {
	location: IRange;
	message: string;
}

export class ASTNode {
	public type: string;
	public name: string;
	public start: number;
	public end: number;
	public parent: ASTNode;

	constructor(parent: ASTNode, type: string, name: string, start: number, end?: number) {
		this.type = type;
		this.name = name;
		this.start = start;
		this.end = end;
		this.parent = parent;
	}

	public getNodeLocation(): JSONLocation {
		let path = this.parent ? this.parent.getNodeLocation() : new JSONLocation([]);
		if (this.name) {
			path = path.append(this.name);
		}
		return path;
	}


	public getChildNodes(): ASTNode[] {
		return [];
	}

	public getValue(): any {
		// override in children
		return;
	}

	public contains(offset: number, includeRightBound: boolean = false): boolean {
		return offset >= this.start && offset < this.end || includeRightBound && offset === this.end;
	}

	public visit(visitor: (node: ASTNode) => boolean): boolean {
		return visitor(this);
	}

	public getNodeFromOffset(offset: number): ASTNode {
		let findNode = (node: ASTNode): ASTNode => {
			if (offset >= node.start && offset < node.end) {
				let children = node.getChildNodes();
				for (let i = 0; i < children.length && children[i].start <= offset; i++) {
					let item = findNode(children[i]);
					if (item) {
						return item;
					}
				}
				return node;
			}
			return null;
		};
		return findNode(this);
	}

	public getNodeFromOffsetEndInclusive(offset: number): ASTNode {
		let findNode = (node: ASTNode): ASTNode => {
			if (offset >= node.start && offset <= node.end) {
				let children = node.getChildNodes();
				for (let i = 0; i < children.length && children[i].start <= offset; i++) {
					let item = findNode(children[i]);
					if (item) {
						return item;
					}
				}
				return node;
			}
			return null;
		};
		return findNode(this);
	}

	public validate(schema: JsonSchema.IJSONSchema, validationResult: ValidationResult, matchingSchemas: IApplicableSchema[], offset: number = -1): void {
		if (offset !== -1 && !this.contains(offset)) {
			return;
		}

		if (Array.isArray(schema.type)) {
			if ((<string[]>schema.type).indexOf(this.type) === -1) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: schema.errorMessage || localize('typeArrayMismatchWarning', 'Incorrect type. Expected one of {0}', (<string[]>schema.type).join(', '))
				});
			}
		}
		else if (schema.type) {
			if (this.type !== schema.type) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: schema.errorMessage || localize('typeMismatchWarning', 'Incorrect type. Expected "{0}"', schema.type)
				});
			}
		}
		if (Array.isArray(schema.allOf)) {
			schema.allOf.forEach((subSchema) => {
				this.validate(subSchema, validationResult, matchingSchemas, offset);
			});
		}
		if (schema.not) {
			let subValidationResult = new ValidationResult();
			let subMatchingSchemas: IApplicableSchema[] = [];
			this.validate(schema.not, subValidationResult, subMatchingSchemas, offset);
			if (!subValidationResult.hasErrors()) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('notSchemaWarning', "Matches a schema that is not allowed.")
				});
			}
			if (matchingSchemas) {
				subMatchingSchemas.forEach((ms) => {
					ms.inverted = !ms.inverted;
					matchingSchemas.push(ms);
				});
			}
		}

		let testAlternatives = (alternatives: JsonSchema.IJSONSchema[], maxOneMatch: boolean) => {
			let matches = [];

			// remember the best match that is used for error messages
			let bestMatch: { schema: JsonSchema.IJSONSchema; validationResult: ValidationResult; matchingSchemas: IApplicableSchema[]; } = null;
			alternatives.forEach((subSchema) => {
				let subValidationResult = new ValidationResult();
				let subMatchingSchemas: IApplicableSchema[] = [];
				this.validate(subSchema, subValidationResult, subMatchingSchemas);
				if (!subValidationResult.hasErrors()) {
					matches.push(subSchema);
				}
				if (!bestMatch) {
					bestMatch = { schema: subSchema, validationResult: subValidationResult, matchingSchemas: subMatchingSchemas };
				} else {
					if (!maxOneMatch && !subValidationResult.hasErrors() && !bestMatch.validationResult.hasErrors()) {
						// no errors, both are equally good matches
						bestMatch.matchingSchemas.push.apply(bestMatch.matchingSchemas, subMatchingSchemas);
						bestMatch.validationResult.propertiesMatches += subValidationResult.propertiesMatches;
						bestMatch.validationResult.propertiesValueMatches += subValidationResult.propertiesValueMatches;
					} else {
						let compareResult = subValidationResult.compare(bestMatch.validationResult);
						if (compareResult > 0) {
							// our node is the best matching so far
							bestMatch = { schema: subSchema, validationResult: subValidationResult, matchingSchemas: subMatchingSchemas };
						} else if (compareResult === 0) {
							// there's already a best matching but we are as good
							bestMatch.matchingSchemas.push.apply(bestMatch.matchingSchemas, subMatchingSchemas);
						}
					}
				}
			});

			if (matches.length > 1 && maxOneMatch) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.start + 1 },
					message: localize('oneOfWarning', "Matches multiple schemas when only one must validate.")
				});
			}
			if (bestMatch !== null) {
				validationResult.merge(bestMatch.validationResult);
				validationResult.propertiesMatches += bestMatch.validationResult.propertiesMatches;
				validationResult.propertiesValueMatches += bestMatch.validationResult.propertiesValueMatches;
				if (matchingSchemas) {
					matchingSchemas.push.apply(matchingSchemas, bestMatch.matchingSchemas);
				}
			}
			return matches.length;
		};
		if (Array.isArray(schema.anyOf)) {
			testAlternatives(schema.anyOf, false);
		}
		if (Array.isArray(schema.oneOf)) {
			testAlternatives(schema.oneOf, true);
		}

		if (Array.isArray(schema.enum)) {
			if (schema.enum.indexOf(this.getValue()) === -1) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('enumWarning', 'Value is not an accepted value. Valid values: {0}', JSON.stringify(schema.enum))
				});
			} else {
				validationResult.enumValueMatch = true;
			}
		}

		if (matchingSchemas !== null) {
			matchingSchemas.push({ node: this, schema: schema });
		}
	}
}

export class ScalarASTNode extends ASTNode {
  constructor(parent: ASTNode, type: string, name: string, start: number, end?: number) {
		super(parent, type, name, start, end);
	}
}

export class NullASTNode extends ScalarASTNode {

	constructor(parent: ASTNode, name: string, start: number, end?: number) {
		super(parent, 'null', name, start, end);
	}

	public getValue(): any {
		return null;
	}
}

export class BooleanASTNode extends ScalarASTNode {

	private value: boolean;

	constructor(parent: ASTNode, name: string, value: boolean, start: number, end?: number) {
		super(parent, 'boolean', name, start, end);
		this.value = value;
	}

	public getValue(): any {
		return this.value;
	}

}


export class NumberASTNode extends ScalarASTNode {

	public isInteger: boolean;
	public value: number;

	constructor(parent: ASTNode, name: string, start: number, end?: number) {
		super(parent, 'number', name, start, end);
		this.isInteger = true;
		this.value = Number.NaN;
	}

	public getValue(): any {
		return this.value;
	}

	public validate(schema: JsonSchema.IJSONSchema, validationResult: ValidationResult, matchingSchemas: IApplicableSchema[], offset: number = -1): void {
		if (offset !== -1 && !this.contains(offset)) {
			return;
		}

		// work around type validation in the base class
		let typeIsInteger = false;
		if (schema.type === 'integer' || (Array.isArray(schema.type) && (<string[]>schema.type).indexOf('integer') !== -1)) {
			typeIsInteger = true;
		}
		if (typeIsInteger && this.isInteger === true) {
			this.type = 'integer';
		}
		super.validate(schema, validationResult, matchingSchemas, offset);
		this.type = 'number';

		let val = this.getValue();

		if (typeof schema.multipleOf === 'number') {
			if (val % schema.multipleOf !== 0) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('multipleOfWarning', 'Value is not divisible by {0}', schema.multipleOf)
				});
			}
		}

		if (typeof schema.minimum === 'number') {
			if (schema.exclusiveMinimum && val <= schema.minimum) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('exclusiveMinimumWarning', 'Value is below the exclusive minimum of {0}', schema.minimum)
				});
			}
			if (!schema.exclusiveMinimum && val < schema.minimum) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('minimumWarning', 'Value is below the minimum of {0}', schema.minimum)
				});
			}
		}

		if (typeof schema.maximum === 'number') {
			if (schema.exclusiveMaximum && val >= schema.maximum) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('exclusiveMaximumWarning', 'Value is above the exclusive maximum of {0}', schema.maximum)
				});
			}
			if (!schema.exclusiveMaximum && val > schema.maximum) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('maximumWarning', 'Value is above the maximum of {0}', schema.maximum)
				});
			}
		}

	}
}

export class StringASTNode extends ScalarASTNode {
	public isKey: boolean;
	public value: string;

	constructor(parent: ASTNode, name: string, isKey: boolean, start: number, end?: number) {
		super(parent, 'string', name, start, end);
		this.isKey = isKey;
		this.value = '';
	}

	public getValue(): any {
		return this.value;
	}

	public validate(schema: JsonSchema.IJSONSchema, validationResult: ValidationResult, matchingSchemas: IApplicableSchema[], offset: number = -1): void {
		if (offset !== -1 && !this.contains(offset)) {
			return;
		}
		super.validate(schema, validationResult, matchingSchemas, offset);

		if (schema.minLength && this.value.length < schema.minLength) {
			validationResult.warnings.push({
				location: { start: this.start, end: this.end },
				message: localize('minLengthWarning', 'String is shorter than the minimum length of ', schema.minLength)
			});
		}

		if (schema.maxLength && this.value.length > schema.maxLength) {
			validationResult.warnings.push({
				location: { start: this.start, end: this.end },
				message: localize('maxLengthWarning', 'String is shorter than the maximum length of ', schema.maxLength)
			});
		}

		if (schema.pattern) {
			let regex = new RegExp(schema.pattern);
			if (!regex.test(this.value)) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: schema.errorMessage || localize('patternWarning', 'String does not match the pattern of "{0}"', schema.pattern)
				});
			}
		}

	}
}

export class ArrayASTNode extends ASTNode {

	public items: ASTNode[];

	constructor(parent: ASTNode, name: string, start: number, end?: number) {
		super(parent, 'array', name, start, end);
		this.items = [];
	}

	public getChildNodes(): ASTNode[] {
		return this.items;
	}

	public getValue(): any {
		return this.items.map((v) => v.getValue());
	}

	public addItem(item: ASTNode): boolean {
		if (item) {
			this.items.push(item);
			return true;
		}
		return false;
	}

	public visit(visitor: (node: ASTNode) => boolean): boolean {
		let ctn = visitor(this);
		for (let i = 0; i < this.items.length && ctn; i++) {
			ctn = this.items[i].visit(visitor);
		}
		return ctn;
	}

	public validate(schema: JsonSchema.IJSONSchema, validationResult: ValidationResult, matchingSchemas: IApplicableSchema[], offset: number = -1): void {
		if (offset !== -1 && !this.contains(offset)) {
			return;
		}
		super.validate(schema, validationResult, matchingSchemas, offset);

		if (Array.isArray(schema.items)) {
			let subSchemas = <JsonSchema.IJSONSchema[]> schema.items;
			subSchemas.forEach((subSchema, index) => {
				let itemValidationResult = new ValidationResult();
				let item = this.items[index];
				if (item) {
					item.validate(subSchema, itemValidationResult, matchingSchemas, offset);
					validationResult.mergePropertyMatch(itemValidationResult);
				} else if (this.items.length >= subSchemas.length) {
					validationResult.propertiesValueMatches++;
				}
			});

			if (schema.additionalItems === false && this.items.length > subSchemas.length) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('additionalItemsWarning', 'Array has too many items according to schema. Expected {0} or fewer', subSchemas.length)
				});
			} else if (this.items.length >= subSchemas.length) {
				validationResult.propertiesValueMatches += (this.items.length - subSchemas.length);
			}
		}
		else if (schema.items) {
			this.items.forEach((item) => {
				let itemValidationResult = new ValidationResult();
				item.validate(schema.items, itemValidationResult, matchingSchemas, offset);
				validationResult.mergePropertyMatch(itemValidationResult);
			});
		}

		if (schema.minItems && this.items.length < schema.minItems) {
			validationResult.warnings.push({
				location: { start: this.start, end: this.end },
				message: localize('minItemsWarning', 'Array has too few items. Expected {0} or more', schema.minItems)
			});
		}

		if (schema.maxItems && this.items.length > schema.maxItems) {
			validationResult.warnings.push({
				location: { start: this.start, end: this.end },
				message: localize('maxItemsWarning', 'Array has too many items. Expected {0} or fewer', schema.minItems)
			});
		}

		if (schema.uniqueItems === true) {
			let values = this.items.map((node) => {
				return node.getValue();
			});
			let duplicates = values.some((value, index) => {
				return index !== values.lastIndexOf(value);
			});
			if (duplicates) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('uniqueItemsWarning', 'Array has duplicate items')
				});
			}
		}
	}
}

export class PropertyASTNode extends ASTNode {
	public key: StringASTNode;
	public value: ASTNode;
	public colonOffset: number;

	constructor(parent: ASTNode) {
		super(parent, 'property', null, 0, 0);
		this.colonOffset = -1;
	}

	public getChildNodes(): ASTNode[] {
		return this.value ? [this.key, this.value] : [this.key];
	}

	public setKey(key: StringASTNode): boolean {
		this.key = key;
		if (this.key != null) {
			key.parent = this;
			key.name = key.value;
			this.start = key.start;
			this.end = key.end;
		}
		return key !== null;
	}

	public setValue(value: ASTNode): boolean {
		this.value = value;
		if (this.value != null) {
			this.value.name = this.key.name;
		}
		return value !== null;
	}

	public visit(visitor: (node: ASTNode) => boolean): boolean {
		return visitor(this) && this.key.visit(visitor) && this.value && this.value.visit(visitor);
	}

	public validate(schema: JsonSchema.IJSONSchema, validationResult: ValidationResult, matchingSchemas: IApplicableSchema[], offset: number = -1): void {
		if (offset !== -1 && !this.contains(offset)) {
			return;
		}
		if (this.value) {
			this.value.validate(schema, validationResult, matchingSchemas, offset);
		}
	}
}

export class ObjectASTNode extends ASTNode {
	public properties: PropertyASTNode[];

	constructor(parent: ASTNode, name: string, start: number, end?: number) {
		super(parent, 'object', name, start, end);

		this.properties = [];
	}

	public getChildNodes(): ASTNode[] {
		return this.properties;
	}

	public addProperty(node: PropertyASTNode): boolean {
		if (!node) {
			return false;
		}
		this.properties.push(node);
		return true;
	}

	public getFirstProperty(key: string): PropertyASTNode {
		for (let i = 0; i < this.properties.length; i++) {
			if (this.properties[i].key.value === key) {
				return this.properties[i];
			}
		}
		return null;
	}

	public getKeyList(): string[] {
		return this.properties.map((p) => p.key.getValue());
	}

	public getValue(): any {
		let value: any = {};
		this.properties.forEach((p) => {
			let v = p.value && p.value.getValue();
			if (v) {
				value[p.key.getValue()] = v;
			}
		});
		return value;
	}

	public visit(visitor: (node: ASTNode) => boolean): boolean {
		let ctn = visitor(this);
		for (let i = 0; i < this.properties.length && ctn; i++) {
			ctn = this.properties[i].visit(visitor);
		}
		return ctn;
	}

	public validate(schema: JsonSchema.IJSONSchema, validationResult: ValidationResult, matchingSchemas: IApplicableSchema[], offset: number = -1): void {
		if (offset !== -1 && !this.contains(offset)) {
			return;
		}

		super.validate(schema, validationResult, matchingSchemas, offset);
		let seenKeys: { [key: string]: ASTNode } = {};
		let unprocessedProperties: string[] = [];
		this.properties.forEach((node) => {
			let key = node.key.value;
			seenKeys[key] = node.value;
			unprocessedProperties.push(key);
		});

		if (Array.isArray(schema.required)) {
			schema.required.forEach((propertyName: string) => {
				if (!seenKeys[propertyName]) {
					let key = this.parent && this.parent && (<PropertyASTNode>this.parent).key;
					let location = key ? { start: key.start, end: key.end } : { start: this.start, end: this.start + 1 };
					validationResult.warnings.push({
						location: location,
						message: localize('MissingRequiredPropWarning', 'Missing property "{0}"', propertyName)
					});
				}
			});
		}

		let propertyProcessed = (prop: string) => {
			let index = unprocessedProperties.indexOf(prop);
			while (index >= 0) {
				unprocessedProperties.splice(index, 1);
				index = unprocessedProperties.indexOf(prop);
			}
		};

		if (schema.properties) {
			Object.keys(schema.properties).forEach((propertyName: string) => {
				propertyProcessed(propertyName);
				let prop = schema.properties[propertyName];
				let child = seenKeys[propertyName];
				if (child) {
					let propertyvalidationResult = new ValidationResult();
					child.validate(prop, propertyvalidationResult, matchingSchemas, offset);
					validationResult.mergePropertyMatch(propertyvalidationResult);
				}

			});
		}

		if (schema.patternProperties) {
			Object.keys(schema.patternProperties).forEach((propertyPattern: string) => {
				let regex = new RegExp(propertyPattern);
				unprocessedProperties.slice(0).forEach((propertyName: string) => {
					if (regex.test(propertyName)) {
						propertyProcessed(propertyName);
						let child = seenKeys[propertyName];
						if (child) {
							let propertyvalidationResult = new ValidationResult();
							child.validate(schema.patternProperties[propertyPattern], propertyvalidationResult, matchingSchemas, offset);
							validationResult.mergePropertyMatch(propertyvalidationResult);
						}

					}
				});
			});
		}

		if (schema.additionalProperties) {
			unprocessedProperties.forEach((propertyName: string) => {
				let child = seenKeys[propertyName];
				if (child) {
					let propertyvalidationResult = new ValidationResult();
					child.validate(schema.additionalProperties, propertyvalidationResult, matchingSchemas, offset);
					validationResult.mergePropertyMatch(propertyvalidationResult);
				}
			});
		} else if (schema.additionalProperties === false) {
			if (unprocessedProperties.length > 0) {
				unprocessedProperties.forEach((propertyName: string) => {
					let child = seenKeys[propertyName];
					if (child) {
						let propertyNode = <PropertyASTNode>child.parent;

						validationResult.warnings.push({
							location: { start: propertyNode.key.start, end: propertyNode.key.end },
							message: localize('DisallowedExtraPropWarning', 'Property {0} is not allowed', propertyName)
						});
					}
				});
			}
		}

		if (schema.maxProperties) {
			if (this.properties.length > schema.maxProperties) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('MaxPropWarning', 'Object has more properties than limit of {0}', schema.maxProperties)
				});
			}
		}

		if (schema.minProperties) {
			if (this.properties.length < schema.minProperties) {
				validationResult.warnings.push({
					location: { start: this.start, end: this.end },
					message: localize('MinPropWarning', 'Object has fewer properties than the required number of {0}', schema.minProperties)
				});
			}
		}

		if (schema.dependencies) {
			Object.keys(schema.dependencies).forEach((key: string) => {
				let prop = seenKeys[key];
				if (prop) {
					if (Array.isArray(schema.dependencies[key])) {
						let valueAsArray: string[] = schema.dependencies[key];
						valueAsArray.forEach((requiredProp: string) => {
							if (!seenKeys[requiredProp]) {
								validationResult.warnings.push({
									location: { start: this.start, end: this.end },
									message: localize('RequiredDependentPropWarning', 'Object is missing property {0} required by property {1}', requiredProp, key)
								});
							} else {
								validationResult.propertiesValueMatches++;
							}
						});
					} else if (schema.dependencies[key]) {
						let valueAsSchema: JsonSchema.IJSONSchema = schema.dependencies[key];
						let propertyvalidationResult = new ValidationResult();
						this.validate(valueAsSchema, propertyvalidationResult, matchingSchemas, offset);
						validationResult.mergePropertyMatch(propertyvalidationResult);
					}
				}
			});
		}
	}
}

export class YAMLDocumentConfig {
	public ignoreDanglingComma: boolean;

	constructor() {
		this.ignoreDanglingComma = false;
	}
}

export interface IApplicableSchema {
	node: ASTNode;
	inverted?: boolean;
	schema: JsonSchema.IJSONSchema;
}

export class ValidationResult {
	public errors: IError[];
	public warnings: IError[];

	public propertiesMatches: number;
	public propertiesValueMatches: number;
	public enumValueMatch: boolean;

	constructor() {
		this.errors = [];
		this.warnings = [];
		this.propertiesMatches = 0;
		this.propertiesValueMatches = 0;
		this.enumValueMatch = false;
	}

	public hasErrors(): boolean {
		return !!this.errors.length || !!this.warnings.length;
	}

	public mergeAll(validationResults: ValidationResult[]): void {
		validationResults.forEach((validationResult) => {
			this.merge(validationResult);
		});
	}

	public merge(validationResult: ValidationResult): void {
		this.errors = this.errors.concat(validationResult.errors);
		this.warnings = this.warnings.concat(validationResult.warnings);
	}

	public mergePropertyMatch(propertyValidationResult: ValidationResult): void {
		this.merge(propertyValidationResult);
		this.propertiesMatches++;
		if (propertyValidationResult.enumValueMatch || !propertyValidationResult.hasErrors() && propertyValidationResult.propertiesMatches) {
			this.propertiesValueMatches++;
		}
	}

	public compare(other: ValidationResult): number {
		let hasErrors = this.hasErrors();
		if (hasErrors !== other.hasErrors()) {
			return hasErrors ? -1 : 1;
		}
		if (this.enumValueMatch !== other.enumValueMatch) {
			return other.enumValueMatch ? -1 : 1;
		}
		if (this.propertiesValueMatches !== other.propertiesValueMatches) {
			return this.propertiesValueMatches - other.propertiesValueMatches;
		}
		return this.propertiesMatches - other.propertiesMatches;
	}

}

export class YAMLDocument {
	public config: YAMLDocumentConfig;
	public root: ASTNode;

	public validationResult: ValidationResult;

	constructor(config: YAMLDocumentConfig) {
		this.config = config;
		this.validationResult = new ValidationResult();
	}

	public get errors(): IError[] {
		return this.validationResult.errors;
	}

	public get warnings(): IError[] {
		return this.validationResult.warnings;
	}

	public getNodeFromOffset(offset: number): ASTNode {
		return this.root && this.root.getNodeFromOffset(offset);
	}

	public getNodeFromOffsetEndInclusive(offset: number): ASTNode {
		return this.root && this.root.getNodeFromOffsetEndInclusive(offset);
	}

	public visit(visitor: (node: ASTNode) => boolean): void {
		if (this.root) {
			this.root.visit(visitor);
		}
	}

	public validate(schema: JsonSchema.IJSONSchema, matchingSchemas: IApplicableSchema[] = null, offset: number = -1): void {
		if (this.root) {
			this.root.validate(schema, this.validationResult, matchingSchemas, offset);
		}
	}
}

function ConvertNode(s: YamlInterface.YAMLNode, astParent: ASTNode) {
	var astNode: ASTNode;

	if (!s || !s.kind) {
		return;
	}

	// Convert yamlAST to match jsonAST
	switch (s.kind) {
		case YamlInterface.Kind.SCALAR:
			switch (s.type) {
				case YamlInterface.NodeType.null:
					let nodeNull: NullASTNode =
						new NullASTNode(astParent, s.name, s.start, s.end);
					astNode = nodeNull;
					break;
				case YamlInterface.NodeType.number:
					let nodeNumber: NumberASTNode =
						new NumberASTNode(astParent, s.name, s.start, s.end);
					nodeNumber.isInteger = s.isInteger;
					nodeNumber.value = s.value;
					astNode = nodeNumber;
					break;
				case YamlInterface.NodeType.boolean:
					let nodeBoolean: BooleanASTNode =
						new BooleanASTNode(astParent, s.name, s.value, s.start, s.end);
					astNode = nodeBoolean;
					break;
				case YamlInterface.NodeType.string:
					let nodeString: StringASTNode =
						new StringASTNode(astParent, s.name, s.isKey, s.start, s.end);
					nodeString.value = s.value;
					astNode = nodeString;
					break;
			}
			break;
		case YamlInterface.Kind.SEQ:
			let nodeArray: ArrayASTNode =
				new ArrayASTNode(astParent, s.name, s.start, s.end);
			astNode = nodeArray;
			s.items.forEach(item => {
				let itemNode = ConvertNode(item, nodeArray);
				nodeArray.items.push(itemNode);
			});
			break;

		case YamlInterface.Kind.MAP:
			let nodeObject: ObjectASTNode =
				new ObjectASTNode(astParent, s.name, s.start, s.end);
			astNode = nodeObject;
			s.properties.forEach(prop => {
				let propNode = ConvertNode(prop, nodeObject);
				nodeObject.properties.push(<PropertyASTNode>propNode);
			});
			break;

		case YamlInterface.Kind.MAPPING:
			let nodeProperty: PropertyASTNode = new PropertyASTNode(astParent);
			astNode = nodeProperty;
			let keyNode = <StringASTNode>ConvertNode(s.key, nodeProperty);
			let valNode = ConvertNode(s.value, nodeProperty);
			nodeProperty.setKey(keyNode);
			nodeProperty.setValue(valNode);
			break;
	}

	return astNode;

	// TODO: ANCHOR_REF ?
	// TODO: INCLUDE_REF ?
}


export function parse(text: string, config = new YAMLDocumentConfig()): YAMLDocument {

	let _doc = new YAMLDocument(config);

  var yamlInterface = YamlLoader.load(text, YamlCommon.extend({ schema: DEFAULT_SAFE_SCHEMA }, config));

	_doc.root = ConvertNode(<any>yamlInterface, null);
	yamlInterface.errors.forEach(function(err) {
		// ignore multiple errors on the same offset
	  _doc.errors.push({ message: err.message, location: { start: err.mark.position, end: err.mark.position + err.mark.buffer.length } });
	});

	return _doc;
}