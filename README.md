vscode-yaml-validation
===

#### Superceeded: Thanks for visiting, but there are much newer and better YAML Language Server Plugins available now. I created this when there was nothing else available. But I was never really able to adequately commit to this effort, so I happily defer to the more robust versions now. 

#### Note: This is not the best starting point, if you're interested in creating VS Code Extensions. They released an updated template for this type of application, right after it was released. Start with the latest examples and documentation provided by the makers of VS Code, and you might save yourself a great deal of effort later on.

## Description

This is a work in progress/early release version, of a VSCode extension for YAML validation against a JSON schema.

![screen-shot-01.png](xtras/screen-shot-01.png?raw=true)

![screen-shot-02.png](xtras/screen-shot-02.png?raw=true)


This extension uses json.schemas definitions that it finds in the standard VSCode settings file.

**.vscode/settings.json**

    "json.schemas": [
      {
        "fileMatch": [ "**/default.json" ],
        "url": "./src/specs/schema/sources/JsonSchema.d4.json"
      },
      {
        "fileMatch": [ "/.babelrc" ],
        "url": "http://json.schemastore.org/babelrc
      },
      {
        "fileMatch": [ "**/swagger.yaml", "**/swagger.json" ],
        "url": "http://json.schemastore.org/swagger-2.0"
      }
    ]


## Contributions

Contents of the /server/src/yaml folder are from the following repos, with modifications:

- https://github.com/mulesoft-labs/yaml-ast-parser
- https://github.com/nodeca/js-yaml

They are included here, because I intend to take major liberties and make further strides towards
conversion to TypeScript, if this effort proves viable.

Contents of the /server/src/json and /client folder are from the following repos, with modifications:

- https://github.com/Microsoft/vscode/tree/master/extensions/json
- https://github.com/Microsoft/vscode-languageserver-node-example

PetStore schemas were from the following repo:

- https://raw.githubusercontent.com/OAI/OpenAPI-Specification/master/examples/v2.0/json/petstore-expanded.json


## Useful Info

- https://code.visualstudio.com/docs/tools/vscecli
- https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/extension-manifest.md

## License
[MIT](LICENSE.txt)

