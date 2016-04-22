/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, ITextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentIdentifier, TextDocumentPosition, CompletionList,
	CompletionItem, CompletionItemKind, NotificationType, RequestType
} from 'vscode-languageserver';

import {xhr, XHROptions, XHRResponse, configure as configureHttpRequests} from 'request-light';
import path = require('path');
import fs = require('fs');
import URI from './json/utils/uri';
import Strings = require('./json/utils/strings');
import {parse as parseJSON, JSONDocument} from './json/jsonParser';
import { JSONSchemaService, ISchemaAssociations } from './json/jsonSchemaService';
import { schemaContributions } from './configuration';
import { IJSONSchema } from './json/jsonSchema';
import {JSONCompletion} from './json/jsonCompletion';

import { parse as parseYaml, ObjectASTNode, YAMLDocument } from './yaml/yamlParser';

namespace TelemetryNotification {
	export const type: NotificationType<{ key: string, data: any }> = { get method() { return 'telemetry'; } };
}

namespace SchemaAssociationNotification {
	export const type: NotificationType<ISchemaAssociations> = { get method() { return 'json/schemaAssociations'; } };
}

namespace VSCodeContentRequest {
	export const type: RequestType<string, string, any> = { get method() { return 'vscode/content'; } };
}

// Create a connection for the server. The connection uses
// Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// const filesAssociationContribution = new FileAssociationContribution();
// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites.
let workspaceRoot: URI;
connection.onInitialize((params: InitializeParams): InitializeResult => {
	workspaceRoot = URI.parse(params.rootPath);
	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			// Tell the client that the server support code complete
			completionProvider: { resolveProvider: true }
			// hoverProvider: true,
			// documentSymbolProvider: true,
			// documentRangeFormattingProvider: true,
			// documentFormattingProvider: true
		}
	};
});

let workspaceContext = {
	toResource: (workspaceRelativePath: string) => {
		if (typeof workspaceRelativePath === 'string' && workspaceRoot) {
			return URI.file(path.join(workspaceRoot.fsPath, workspaceRelativePath)).toString();
		}
		return workspaceRelativePath;
	}
};

let telemetry = {
	log: (key: string, data: any) => {
		connection.sendNotification(TelemetryNotification.type, { key, data });
	}
};

let request = (options: XHROptions): Thenable<XHRResponse>  => {
	if (Strings.startsWith(options.url, 'file://')) {
		let fsPath = URI.parse(options.url).fsPath;
		return new Promise<XHRResponse>((c, e) => {
			fs.readFile(fsPath, 'UTF-8', (err, result) => {
				err ? e({ responseText: '', status: 404 }) : c({ responseText: result.toString(), status: 200 });
			});
		});
	} else if (Strings.startsWith(options.url, 'vscode://')) {
		return connection.sendRequest(VSCodeContentRequest.type, options.url).then(responseText => {
			return {
				responseText: responseText,
				status: 200
			};
		}, error => {
			return {
				responseText: error.message,
				status: 404
			};
		});
	}
	return xhr(options);
};

let contributions = [
	// new ProjectJSONContribution(request),
	// new PackageJSONContribution(request),
	// new BowerJSONContribution(request),
	// new GlobPatternContribution(),
	// filesAssociationContribution
];

let jsonSchemaService = new JSONSchemaService(request, workspaceContext, telemetry);
jsonSchemaService.setSchemaContributions(schemaContributions);

let jsonCompletion = new JSONCompletion(jsonSchemaService, connection.console, contributions);
// let jsonHover = new JSONHover(jsonSchemaService, contributions);
// let jsonDocumentSymbols = new JSONDocumentSymbols();


// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	validateTextDocument(change.document);
});

// hold the maxNumberOfProblems setting
let maxValidationIssues: number;

// These are the example settings we defined in the client's package.json
interface YamlSettings {
	maxValidationIssues: number;
}

// The settings interface describe the server relevant settings part
interface Settings {
	yaml: YamlSettings;
	json: {
		schemas: JSONSchemaSettings[];
	};
	http : {
		proxy: string;
		proxyStrictSSL: boolean;
	};
}

interface JSONSchemaSettings {
	fileMatch?: string[];
	url?: string;
	schema?: IJSONSchema;
}

let jsonConfigurationSettings : JSONSchemaSettings[] = void 0;
let schemaAssociations : ISchemaAssociations = void 0;

// The settings have changed. Is send on server activation as well.
connection.onDidChangeConfiguration((change) => {
	let settings = <Settings>change.settings;
	configureHttpRequests(settings.http && settings.http.proxy, settings.http && settings.http.proxyStrictSSL);

	maxValidationIssues = (settings.yaml && settings.yaml.maxValidationIssues) || 100;

	jsonConfigurationSettings = settings.json && settings.json.schemas;
	updateConfiguration();
});

// The jsonValidation extension configuration has changed
connection.onNotification(SchemaAssociationNotification.type, (associations) => {
	schemaAssociations = associations;
	updateConfiguration();
});

function updateConfiguration() {
	jsonSchemaService.clearExternalSchemas();
	if (schemaAssociations) {
		for (var pattern in schemaAssociations) {
			let association = schemaAssociations[pattern];
			if (Array.isArray(association)) {
				association.forEach(url => {
					jsonSchemaService.registerExternalSchema(url, [pattern]);
				});
			}
		}
	}
	if (jsonConfigurationSettings) {
		jsonConfigurationSettings.forEach((schema) => {
			if (schema.fileMatch) {
				let url = schema.url;
				if (!url && schema.schema) {
					url = schema.schema.id;
					if (!url) {
						url = 'vscode://schemas/custom/' + encodeURIComponent(schema.fileMatch.join('&'));
					}
				}
				if (!Strings.startsWith(url, 'http://') && !Strings.startsWith(url, 'https://') && !Strings.startsWith(url, 'file://')) {
					let resourceURL = workspaceContext.toResource(url);
					if (resourceURL) {
						url = resourceURL.toString();
					}
				}
				if (url) {
					jsonSchemaService.registerExternalSchema(url, schema.fileMatch, schema.schema);
				}
			}
		});
	}
	// Revalidate any open text documents
	documents.all().forEach(validateTextDocument);
}

// This is where the magic begins
function validateTextDocument(textDocument: ITextDocument): void {

	// Gets a parsed document (AST)
	let yamlDocument = parseYaml(textDocument.getText(), null);

	jsonSchemaService.getSchemaForResource(textDocument.uri, yamlDocument).then(function(schema) {
		if (schema) {
			if (schema.errors.length && yamlDocument.root) {
				let astRoot = yamlDocument.root;
				let property = astRoot.type === 'object' ? (<ObjectASTNode>astRoot).getFirstProperty('$schema') : null;
				if (property) {
					let node = property.value || property;
					yamlDocument.warnings.push({ location: { start: node.start, end: node.end }, message: schema.errors[0] });
				} else {
					yamlDocument.warnings.push({ location: { start: astRoot.start, end: astRoot.start + 1 }, message: schema.errors[0] });
				}
			} else {
				yamlDocument.validate(schema.schema);
			}
		}

		let diagnostics: Diagnostic[] = [];
		let added: { [signature: string]: boolean } = {};
		yamlDocument.errors.concat(yamlDocument.warnings).forEach((error, idx) => {
			// remove duplicated messages
			let signature = error.location.start + ' ' + error.location.end + ' ' + error.message;
			if (!added[signature]) {
				added[signature] = true;
				let range = {
					start: textDocument.positionAt(error.location.start),
					end: textDocument.positionAt(error.location.end)
				};
				diagnostics.push({
					severity: idx >= yamlDocument.errors.length ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
					range: range,
					message: error.message
				});
			}
		});
		// Send the computed diagnostics to VSCode.
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
	});
}

connection.onDidChangeWatchedFiles((change) => {
	// Monitored files have change in VSCode
	connection.console.log('We recevied an file change event');

	// Monitored files have change in VSCode
	let hasChanges = false;
	change.changes.forEach(c => {
		if (jsonSchemaService.onResourceChange(c.uri)) {
			hasChanges = true;
		}
	});
	if (hasChanges) {
		documents.all().forEach(validateTextDocument);
	}
});

function getJSONDocument(document: ITextDocument): JSONDocument {
	return parseJSON(document.getText());
}

// This handler provides the initial list of the completion items.
connection.onCompletion((textDocumentPosition: TextDocumentPosition): Thenable<CompletionList> => {
	let document = documents.get(textDocumentPosition.uri);
	let jsonDocument = getJSONDocument(document);
	return jsonCompletion.doSuggest(document, textDocumentPosition, jsonDocument);
});

connection.onCompletionResolve((item: CompletionItem) : Thenable<CompletionItem> => {
	return jsonCompletion.doResolve(item);
});

// connection.onHover((textDocumentPosition: TextDocumentPosition): Thenable<Hover> => {
// 	let document = documents.get(textDocumentPosition.uri);
// 	let jsonDocument = getJSONDocument(document);
// 	return jsonHover.doHover(document, textDocumentPosition, jsonDocument);
// });

// connection.onDocumentSymbol((textDocumentIdentifier: TextDocumentIdentifier): Thenable<SymbolInformation[]> => {
// 	let document = documents.get(textDocumentIdentifier.uri);
// 	let jsonDocument = getJSONDocument(document);
// 	return jsonDocumentSymbols.compute(document, jsonDocument);
// });

// connection.onDocumentFormatting((formatParams: DocumentFormattingParams) => {
// 	let document = documents.get(formatParams.textDocument.uri);
// 	return formatJSON(document, null, formatParams.options);
// });

// connection.onDocumentRangeFormatting((formatParams: DocumentRangeFormattingParams) => {
// 	let document = documents.get(formatParams.textDocument.uri);
// 	return formatJSON(document, formatParams.range, formatParams.options);
// });

// This handler resolve additional information for the item selected in
// the completion list.
// connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
// 	if (item.data === 1) {
// 		item.detail = 'TypeScript details',
// 		item.documentation = 'TypeScript documentation'
// 	} else if (item.data === 2) {
// 		item.detail = 'JavaScript details',
// 		item.documentation = 'JavaScript documentation'
// 	}
// 	return item;
// });

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.uri} opened.`);
});

connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});

connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.uri} closed.`);
});
*/

// Listen on the connection
connection.listen();