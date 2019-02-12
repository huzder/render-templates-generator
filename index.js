const parseXML = require("@rgrove/parse-xml"), EOL = require("os").EOL, fs = require("fs"), path = require("path");

function normalizeHtmlStr(str) { return str.replace(/\r*\n*/g, "").replace(/\s{2,}/g, " ").trim(); }
function createNsEntity(data) {
    let ns_name = data.name.split(':');
    let result = ns_name.length === 1 ? { name: ns_name[0], ns: "" } : { name: ns_name[1], ns: ns_name[0] };
    result.type = data.type;
    if (data.value !== undefined)
        result.value = data.value;
    return result;
}
function createNode(data) {
    let result = null;
    if (data.type === "element") {
        result = createNsEntity(data);
        result.attributes = Object.keys(data.attributes)
            .map(n => createNsEntity({ name: n, type: "attribute", value: data.attributes[n] }));
        result.childNodes = data.children.map(createNode);
    } else if (data.type === "text")
        result = { type: data.type, text: data.text };
    return result;
}
class HtmlParser {
    parse(htmlStr) {
        htmlStr = "<root>" + htmlStr + "</root>";
        let doc = parseXML(htmlStr);
        let rootNode = doc.children[0];
        return rootNode.children.map(createNode);
    }
}
class CodeWriterStrings {
    constructor(writerRef, createLayout, afterCreateLayout, pushElement, popElement, renderLiteral, renderContent,
        renderComponent, pushDataItem, popDataItem, updateProperty, setViewModel) {

        this.writerRef = writerRef;
        this.createLayout = this.createStrBuilder(createLayout);
        this.afterCreateLayout = this.createStrBuilder(afterCreateLayout);
        this.pushElement = this.createStrBuilder(pushElement);
        this.popElement = this.createStrBuilder(popElement);
        this.renderLiteral = this.createStrBuilder(renderLiteral);
        this.renderContent = this.createStrBuilder(renderContent);
        this.renderComponent = this.createStrBuilder(renderComponent);
        this.pushDataItem = this.createStrBuilder(pushDataItem);
        this.popDataItem = this.createStrBuilder(popDataItem);
        this.updateProperty = this.createStrBuilder(updateProperty);
        this.setViewModel = this.createStrBuilder(setViewModel);
    }
    createStrBuilder(strFormat) {
        return function () {
            let result = strFormat;
            for (let i = 0; i < arguments.length; i++)
                result = result.replace('$' + i, arguments[i]);
            this.writerRef.write(result);
        }.bind(this);
    }
}
class CodeWriter {
    constructor() {
        this.initialize();
    }
    initialize() {
        this.pipes = {};
        this.codeStrings = this.createCodeWriterStrings();
        this.vars = [];
        this.currentContainerNames = [];
        this.currentContainersCount = 0;
        this.rows = [];
        this.indentLevel = 0;
    }
    createCodeWriterStrings() {
        return new CodeWriterStrings(
            this,
            `createLayout: function($0) {`,
            `}`,
            `this.renderElement($0, $1, $2, $3, function($4) {`,
            `});`,
            `this.renderLiteral($0, $1, "$2", [$3]);`,
            `this.renderContent($0, $1, $2);`,
            `this.renderComponent($0, $1, $2, [$3]);`,
            `this.iterate($0, $1, $2, function($3) {`,
            `});`,
            `this.updateProperty($0, "$1", "$2", [$3]);`,
            `var viewModel = this.resolveViewModel("$0");`
        );
    }
    write(str) { this.rows.push((Array(this.indentLevel * 4).join(" ")) + str); }
    createCodeString() { return this.rows.join(EOL); }
    container(i = 0) { return `container${this.currentContainersCount + i}`; }
    setViewModel(type) {
        this.codeStrings.setViewModel(type);
    }
    pushElement(tagName, index, visibleArg) {
        this.currentContainersCount++;
        this.codeStrings.pushElement(this.container(-1), tagName, index, this.getterFor(visibleArg), this.container());
        this.indentLevel++;
    }
    popElement() {
        this.indentLevel--;
        this.currentContainersCount--;
        this.codeStrings.popElement();
    }
    pushDataItem(index, collectionName, name, type) {
        this.codeStrings.pushDataItem(this.container(), index, collectionName, name);
        this.vars.push(name);
        this.indentLevel++;
    }
    popDataItem() {
        this.vars.pop();
        this.indentLevel--;
        this.codeStrings.popDataItem();
    }
    renderLiteral(index, expr) {
        let textModel = this.parseText(expr);
        if(textModel.format)
            this.codeStrings.renderLiteral(this.container(), index, textModel.format, `${textModel.properties.join(", ")}`);
    }
    renderContent(index, expr) {
        this.codeStrings.renderContent(this.container(), index, this.getterFor(expr));
    }
    renderComponent(index, type, args) {
        this.codeStrings.renderComponent(this.container(), index, type, `${args.split(",").map(a => this.getterFor(a.trim()))}`);
    }
    updateProperty(name, expr) {
        let textModel = this.parseText(expr);
        if(textModel.format)
            this.codeStrings.updateProperty(this.container(), name, textModel.format, `${textModel.properties.join(", ")}`);
    }
    registerPipeline(alias, code) { this.pipes[alias] = code; }
    getPipelineLangTarget() { return null; }
    getterFor(n, pipe) {
        return n && (this.pipes[pipe] || "$0").replace("$0", this.vars.some(v => n.startsWith(v + ".")) ? n : "viewModel." + n);
    }
    parseForeachQuery(queryStr) {
        var matches = /([\w\.]+)\s+(\w+)\s+in\s+([\w\.]+)/.exec(queryStr);
        return { itemType: matches[1], itemVarName: matches[2], collectionName: this.getterFor(matches[3]) };
    }
    parseText(text) {
        var sequence = [];
        var strFormat = text.replace(/{{([\w\.]+\|?[\w\.]*)}}/g, function (ss, m1) {
            var p = this.getterFor.apply(this, m1.split("|"));
            if (sequence.indexOf(p) === -1)
                sequence.push(p);
            return "$" + sequence.indexOf(p);
        }.bind(this));
        return { format: normalizeHtmlStr(strFormat), properties: sequence };
    }

}
class JavascriptCodeWriter extends CodeWriter {
    constructor() {
        super();
    }
    getPipelineLangTarget() { return "js"; }
    initialize(name) {
        super.initialize();
        name = name || "Component";
        this.write("var ASPx, dx;");
        this.write("(function(ASPx, dx) {");
        this.indentLevel++;
        this.write(`ASPx.Components.RegisterComponentLayout("${name}", function(${this.container()}) {`);
        this.indentLevel++;
    }
    createCodeString() {
        this.indentLevel--;
        this.write("});");
        this.indentLevel--;
        this.write("})(ASPx || (ASPx = {}), dx || (dx = {}));");
        return super.createCodeString();
    }
}
class CSharpCodeWriter extends CodeWriter {
    constructor() {
        super();
    }
    getPipelineLangTarget() { return "cs"; }
    initialize(name) {
        super.initialize();
        name = name || "NewComponent";
        this.write("using DevExpress.Web.Bootstrap.Internal.Components.Core;");
        this.write("");
        this.write("namespace DevExpress.Web.Bootstrap.Internal.Components {");
        this.indentLevel++;
        this.write("public partial class " + name + ": ComponentBase {");
        this.indentLevel++;
        this.write(`public const string`);
        this.write(`                 ${name}-v3_CssResourceName = GeneratedFolder + "${name}-v3.generated.css",`);
        this.write(`                 ${name}-v4_CssResourceName = GeneratedFolder + "${name}-v4.generated.css",`);
        this.write(`                 ${name}-JavascriptResourceName = GeneratedFolder + "${name}.generated.js";`);
        this.write(`public override string GetV3CssResourceName() { return ${name}-v3_CssResourceName; }`);
        this.write(`public override string GetV4CssResourceName() { return ${name}-v4_CssResourceName; }`);
        this.write(`public override string GetScriptResourceName() { return ${name}-JavascriptResourceName; }`);
        this.write(``);
        this.write(`public override void CreateLayout(WebControl ${this.container()}) {`);
        this.indentLevel++;
    }
    createCodeString() {
        this.indentLevel--;
        this.write("}");
        this.indentLevel--;
        this.write("}");
        this.indentLevel--;
        this.write("}");
        return super.createCodeString();
    }
    createCodeWriterStrings() {
        return new CodeWriterStrings(
            this,
            `createLayout: function($0) {`,
            `}`,
            `CreateElement($0, $1, $2, $3, ($4) => {`,
            `});`,
            `CreateLiteral($0, $1, "$2", $3);`,
            `CreateContent($0, $1, $2);`,
            `CreateComponent($0, $1, $2, $3);`,
            `Iterate($0, $1, $2, ($3) => {`,
            `});`,
            `UpdateProperty($0, "$1", "$2", $3);`,
            `var viewModel = ResolveViewModel<$0>();`
        );
    }
}
class HierarchyBuilderOptions {
    constructor(directiveNamespace = "dx") {
        this.directiveNamespace = directiveNamespace;
    }
}
HierarchyBuilderOptions.Default = new HierarchyBuilderOptions();

class RenderDecoration {
    constructor(args, onPopCallback) {
        this.args = args;
        this.onPop = (onPopCallback || function () { });
    }
}
class HierarchyBuilder {
    constructor(codeWriter, options) {
        this.codeWriter = codeWriter;
        this.options = options || HierarchyBuilderOptions.Default;
    }

    build(templateStr, name) {
        this.codeWriter.initialize(name || "");
        let parser = new HtmlParser();
        this.processNodes(parser.parse(templateStr));
        return this.codeWriter.createCodeString();
    }
    processNodes(nodes) {
        nodes.forEach(this.processNode.bind(this));
    }
    processNode(node, index) {
        if (node.type === "element") {
            if (node.ns === this.options.directiveNamespace)
                this.processDirective(node, index);
            else
                this.processElement(node, index);
        } else if (node.type === "text") {
            this.processTextNode(node, index);
        }
    }
    processDirective(directive, index) {
        function getValue(attrName) {
            return (directive.attributes.filter(a => a.name === attrName)[0] || {}).value || "";
        }
        switch (directive.name) {
            case "viewmodel":
                this.codeWriter.setViewModel(getValue("type"));
                break;
            case "content":
                this.codeWriter.renderContent(index, getValue("html"));
                break;
            case "component":
                this.codeWriter.renderComponent(index, getValue("type"), getValue("args"));
                break;
            case "foreach":
                var forEachInfo = this.codeWriter.parseForeachQuery(getValue("expression"));
                this.codeWriter.pushDataItem(index, forEachInfo.collectionName, forEachInfo.itemVarName, forEachInfo.itemType);
                this.processNodes(directive.childNodes);
                this.codeWriter.popDataItem();
                break;
            case "pipeline":
                this.codeWriter.registerPipeline(getValue("alias"), getValue(this.codeWriter.getPipelineLangTarget()));
                break;
        }
    }
    processElement(el, index) {
        function sync(updated, old, i) { return updated[i] === undefined ? old[i] : updated[i]; }
        let decorations = el.attributes
            .filter(a => a.ns === this.options.directiveNamespace)
            .map(a => this.processDirectiveAttribute(a, index));
        let pushArgs = decorations.reduce((p, c) => [0, 1, 2].map(i => sync(c.args, p, i)), [el.name, index, null]);
        this.codeWriter.pushElement.apply(this.codeWriter, pushArgs);
        el.attributes.filter(attr => !attr.ns).forEach(this.processAttribute.bind(this));
        this.processNodes(el.childNodes);
        this.codeWriter.popElement();
        decorations.forEach(d => d.onPop());
    }
    processTextNode(textNode, index) {
        this.codeWriter.renderLiteral(index, textNode.text);
    }
    processDirectiveAttribute(attribute, index) {
        switch (attribute.name) {
            case "for":
                var forEachInfo = this.codeWriter.parseForeachQuery(attribute.value);
                this.codeWriter.pushDataItem(index, forEachInfo.collectionName, forEachInfo.itemVarName, forEachInfo.itemType);
                return new RenderDecoration([, 0,], this.codeWriter.popDataItem.bind(this.codeWriter));
            case "visible":
                return new RenderDecoration([, , attribute.value]);
        }
        return new RenderDecoration([, ,]);
    }
    processAttribute(attr) { this.codeWriter.updateProperty(attr.name, attr.value); }
}
const defaultGeneratorSettings = {
    componentsFolder: "components",
    componentPattern: "*.generated.*",
    referencesFile: "projectsettings.csproj",
    resourcesFile: "properties/assemblyInfo.cs",
    postfixes: ["-v3", "-v4"]
};
class ComponentsGenerator {
    constructor(workingFolder, settings = defaultGeneratorSettings) {
        this.workingFolder = workingFolder;
        this.settings = settings;
    }
    updateProjectReferences() {
        let componentsInfos = this.getComponentsInfo();
        let p = path.join(this.workingFolder, this.settings.referencesFile);
        let content = fs.readFileSync(p).toString("utf8");
        let xmlDoc = parseXML(content);
    }
    updateProjectResources() {
        let componentsInfos = this.getComponentsInfo();
        let p = path.join(this.workingFolder, this.settings.resourcesFile);
        let content = fs.readFileSync(p).toString("utf8");
        let rows = content.split(EOL)
                    .filter(r => { return !/WebResource\(Components\.\w+\./.test(r) && !!r; })
                    .concat(componentsInfos.filter(c => c.extension !== "cs").map(c => {
                        let mime = c.extension === "js" ? "Javascript" : "Css";
                        return `[assembly: WebResource(Components.${c.id}.${c.name}_${mime}ResourceName, "text/${mime.toLowerCase()}")]`;
                    }));
        fs.writeFileSync(p, rows.join(EOL));
    }
    getPatternRegex() {
        return new RegExp(this.settings.componentPattern.replace(/\./g, "\\.").replace(/\*/g, "([\\w-]+)"));
    }
    getComponentsInfo() {
        let p = path.join(this.workingFolder, this.settings.componentsFolder);
        return fs.readdirSync(p)
            .map(f => {
                var matches = this.getPatternRegex().exec(f);
                if(matches !== null) {
                    return {
                        id: this.settings.postfixes.reduce((s, c) => s.replace(c, ""), matches[1]),
                        name: matches[1],
                        extension: matches[2],
                        path: path.relative(this.workingFolder, path.join(p, f))
                    };
                }
                return null;
            })
            .filter(f => !!f); 
    }
    createClientCode(name, content) {
        return (new HierarchyBuilder(new JavascriptCodeWriter())).build(content, name);
    }
    createServerCode(name, content) {
        return (new HierarchyBuilder(new CSharpCodeWriter())).build(content, name);
    }
}
module.exports = {
    HierarchyBuilder: HierarchyBuilder,
    HierarchyBuilderOptions: HierarchyBuilderOptions,
    HtmlParser: HtmlParser,
    CodeWriter: CodeWriter,
    JavascriptCodeWriter: JavascriptCodeWriter,
    CSharpCodeWriter: CSharpCodeWriter,
    ComponentsGenerator: ComponentsGenerator
};