const fs = require("fs");
const path = require("path");
const HierarchyBuilder = require("../index").HierarchyBuilder;
const CodeWriter = require("../index").CodeWriter;
const HtmlParser = require("../index").HtmlParser;
const JavascriptCodeWriter = require("../index").JavascriptCodeWriter;
const CSharpCodeWriter = require("../index").CSharpCodeWriter;
const HierarchyBuilderOptions = require("../index").HierarchyBuilderOptions;
const ComponentsGenerator = require("../index").ComponentsGenerator;

describe("HtmlParser", function () {
    var htmlParser;
    beforeEach(function () {
        htmlParser = new HtmlParser();
    });
    it("supports namespaces", function () {
        var result = htmlParser.parse(`<sys:viewmodel type="MyComponent1ViewModel">123</sys:viewmodel>`);
        expect(result.length).toBe(1);
        expect(result[0].ns).toBe("sys");
        expect(result[0].name).toBe("viewmodel");
        expect(result[0].type).toBe("element");
        expect(result[0].attributes[0].name).toBe("type");
        expect(result[0].attributes[0].value).toBe("MyComponent1ViewModel");
        expect(result[0].childNodes[0].type).toBe("text");
        expect(result[0].childNodes[0].text).toBe("123");
    });
    it("can parse content with several root nodes", function () {
        var result = htmlParser.parse(`<sys:viewmodel type="TypeName"></sys:viewmodel><div><span>123</span></div>`);
        expect(result.length).toBe(2);
        expect(result[0].ns).toBe("sys");
        expect(result[0].name).toBe("viewmodel");
        expect(result[1].ns).toBe("");
        expect(result[1].name).toBe("div");
        expect(result[1].childNodes.length).toBe(1);
        expect(result[1].childNodes[0].name).toBe("span");
    });
});
describe("CodeWriter", function () {
    var codeWriter;
    beforeEach(function () {
        codeWriter = new CodeWriter();
    })
    it("getPropertyAccessor return correct getter string", function () {
        expect(codeWriter.getterFor("Field1")).toBe("viewModel.Field1");
        expect(codeWriter.getterFor("item1.Field2")).toBe("viewModel.item1.Field2");

        codeWriter.pushDataItem(0, "Items", "item1", "MyType");

        expect(codeWriter.getterFor("Field1")).toBe("viewModel.Field1");
        expect(codeWriter.getterFor("item1.Field2")).toBe("item1.Field2");
    });
    it("parse literals correctly", function () {
        codeWriter.registerPipeline("fixText", "$0.pipe(Str.fixEOL)");
        codeWriter.pushDataItem(0, "Items", "itemRef", "SomeType");
        let result = codeWriter.parseText(`start {{RootField1|fixText}} middle {{itemRef.AnotherField}} end`);

        expect(result.format).toBe("start $0 middle $1 end");
        expect(result.properties.length).toBe(2);
        expect(result.properties[0]).toBe("viewModel.RootField1.pipe(Str.fixEOL)");
        expect(result.properties[1]).toBe("itemRef.AnotherField");
    });

    function writeSomeCode() {
        codeWriter.initialize("PanelComponent");
        codeWriter.setViewModel('ComponentViewModel1');
        codeWriter.pushElement("div", 0, null);
        codeWriter.updateProperty("class", "class1 {{CssClassName}}");
        codeWriter.renderLiteral(0, "test {{Field1}}");
        codeWriter.pushDataItem(1, "VisibleItems", "itemRef", "ComponentSubItemViewModel");
        codeWriter.renderContent(0, "PanelContent");
        codeWriter.renderComponent(1, "SubcomponentType", "ArgField1, itemRef.isChecked");
        codeWriter.popDataItem();
        codeWriter.popElement();
    }
    describe("for Javascript", function () {
        beforeEach(function () {
            codeWriter = new JavascriptCodeWriter();
            writeSomeCode();
        });
        it("writes correct code", function () {
            expect(codeWriter.createCodeString()).toBe(
                `var ASPx, dx;
(function(ASPx, dx) {
   ASPx.Components.RegisterComponentLayout("PanelComponent", function(container0) {
       var viewModel = this.resolveViewModel("ComponentViewModel1");
       this.renderElement(container0, div, 0, null, function(container1) {
           this.updateProperty(container1, "class", "class1 $0", [viewModel.CssClassName]);
           this.renderLiteral(container1, 0, "test $0", [viewModel.Field1]);
           this.iterate(container1, 1, VisibleItems, function(itemRef) {
               this.renderContent(container1, 0, viewModel.PanelContent);
               this.renderComponent(container1, 1, SubcomponentType, [viewModel.ArgField1,itemRef.isChecked]);
           });
       });
   });
})(ASPx || (ASPx = {}), dx || (dx = {}));`);
        });
    });
    describe("for c#", function () {
        beforeEach(function () {
            codeWriter = new CSharpCodeWriter();
            writeSomeCode();
        });
        it("writes correct code", function () {
            expect(codeWriter.createCodeString()).toBe(
`using DevExpress.Web.Bootstrap.Internal.Components.Core;

namespace DevExpress.Web.Bootstrap.Internal.Components {
   public partial class PanelComponent: ComponentBase {
       public const string
                        PanelComponent-v3_CssResourceName = GeneratedFolder + "PanelComponent-v3.generated.css",
                        PanelComponent-v4_CssResourceName = GeneratedFolder + "PanelComponent-v4.generated.css",
                        PanelComponent-JavascriptResourceName = GeneratedFolder + "PanelComponent.generated.js";
       public override string GetV3CssResourceName() { return PanelComponent-v3_CssResourceName; }
       public override string GetV4CssResourceName() { return PanelComponent-v4_CssResourceName; }
       public override string GetScriptResourceName() { return PanelComponent-JavascriptResourceName; }
       
       public override void CreateLayout(WebControl container0) {
           var viewModel = ResolveViewModel<ComponentViewModel1>();
           CreateElement(container0, div, 0, null, (container1) => {
               UpdateProperty(container1, "class", "class1 $0", viewModel.CssClassName);
               CreateLiteral(container1, 0, "test $0", viewModel.Field1);
               Iterate(container1, 1, VisibleItems, (itemRef) => {
                   CreateContent(container1, 0, viewModel.PanelContent);
                   CreateComponent(container1, 1, SubcomponentType, viewModel.ArgField1,itemRef.isChecked);
               });
           });
       }
   }
}`);
        });
    });
});
describe("HierarchyBuilder", function () {
    var builder, writer;

    class TestCodeWriter extends CodeWriter {
        constructor() {
            super();
            this.traceLog = [];
        }
        getPipelineLangTarget() { return "customlang"; }
        setViewModel(t) {
            this.traceLog.push("setViewModel(" + t + ")");
        }
        registerPipeline(alias, code) {
            this.traceLog.push("registerPipeline(" + alias + ", " + code + ")");
        }
        pushDataItem(index, coll, name, type) {
            this.traceLog.push(`pushDataItem(${index}, ${coll}, ${name}, ${type})`);
        }
        popDataItem() {
            this.traceLog.push(`popDataItem()`);
        }
        pushElement(t, i, v) {
            this.traceLog.push(`pushElement(${t}, ${i}, ${v})`);
        }
        popElement() {
            this.traceLog.push(`popElement()`);
        }
        renderLiteral(i, expr) {
            this.traceLog.push(`renderLiteral(${i}, ${expr})`);
        }
        renderContent(i, expr) {
            this.traceLog.push(`renderContent(${i}, ${expr})`)
        }
        renderComponent(i, type, args) {
            this.traceLog.push(`renderComponent(${i}, ${type}, [${args}])`);
        }
        updateProperty(name, expr) {
            this.traceLog.push(`updateProperty(${name}, ${expr})`);
        }
    }
    beforeEach(function () {
        writer = new TestCodeWriter();
        builder = new HierarchyBuilder(writer, new HierarchyBuilderOptions("myns"));
    });
    describe("build", function () {
        it("processes viewmodel directive", function () {
            builder.build(`<myns:viewmodel type="MyComponent1ViewModel"></myns:viewmodel>`);
            expect(writer.traceLog[0]).toBe("setViewModel(MyComponent1ViewModel)");
        });
        it("processes element declaration", function () {
            builder.build(`<div class="class1 {{Field1}} class2">123</div><div></div>`);
            expect(writer.traceLog[0]).toBe("pushElement(div, 0, null)");
            expect(writer.traceLog[1]).toBe("updateProperty(class, class1 {{Field1}} class2)");
            expect(writer.traceLog[2]).toBe("renderLiteral(0, 123)");
            expect(writer.traceLog[3]).toBe("popElement()");
            expect(writer.traceLog[4]).toBe("pushElement(div, 1, null)");
            expect(writer.traceLog[5]).toBe("popElement()");
        });
        it("processes FOR attribute directives", function () {
            builder.build(`<span></span><div myns:for="NameItemViewModel item1 in Items"></div>`);
            expect(writer.traceLog[0]).toBe("pushElement(span, 0, null)");
            expect(writer.traceLog[1]).toBe("popElement()");
            expect(writer.traceLog[2]).toBe("pushDataItem(1, viewModel.Items, item1, NameItemViewModel)");
            expect(writer.traceLog[3]).toBe("pushElement(div, 0, null)");
            expect(writer.traceLog[4]).toBe("popElement()");
            expect(writer.traceLog[5]).toBe("popDataItem()");
        });
        it("processes FOREACH directives", function () {
            builder.build(`<myns:foreach expression="NameItemViewModel item1 in Items">333</myns:foreach>`);
            expect(writer.traceLog[0]).toBe("pushDataItem(0, viewModel.Items, item1, NameItemViewModel)");
            expect(writer.traceLog[1]).toBe("renderLiteral(0, 333)");
            expect(writer.traceLog[2]).toBe("popDataItem()");
        });
        it("processes content declaration", function () {
            builder.build(`<myns:content html="ContentControl" />`);
            expect(writer.traceLog[0]).toBe("renderContent(0, ContentControl)");
        });
        it("processes component injection", function () {
            builder.build(`<myns:component type="MyComponent1" args="Field1, Field2" />`);
            expect(writer.traceLog[0]).toBe("renderComponent(0, MyComponent1, [Field1, Field2])");
        });
        it("processes conditional visibility attribute", function () {
            builder.build(`<div myns:visible="Field1"></div>`);
            expect(writer.traceLog[0]).toBe("pushElement(div, 0, Field1)");
        });
        it("processes pipeline directives", function () {
            builder.build(`<myns:pipeline alias="fixText" customlang="somecodehere" />11{{Field1|fixText}}22`);
            expect(writer.traceLog[0]).toBe("registerPipeline(fixText, somecodehere)");
        });
    });
});
describe("ComponentsGenerator", function () {
    var testContainerPath, componentsGenerator;

    function createFiles(targetFolder, sourceFolder) {
        if (!fs.existsSync(targetFolder)) {
            fs.mkdirSync(targetFolder);
        }
        fs.readdirSync(sourceFolder).forEach(function (file, index) {
            var curPath = path.join(sourceFolder, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                createFiles(path.join(targetFolder, file), curPath);
            } else {
                fs.writeFileSync(path.join(targetFolder, file), fs.readFileSync(curPath));
            }
        });
    }
    function createRandomDir(rootDir) {
        var d = path.join(rootDir, "container_" + Math.round(Math.random() * 10000));
        fs.mkdirSync(d);
        return d;
    }
    function deleteFolderRecursive(path) {
        if (fs.existsSync(path)) {
            fs.readdirSync(path).forEach(function (file, index) {
                var curPath = path + "/" + file;
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    deleteFolderRecursive(curPath);
                } else {
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(path);
        }
    }
    function getContent(file) {
        return fs.readFileSync(path.join(testContainerPath, file)).toString("utf8");
    }
    beforeEach(function () {
        testContainerPath = createRandomDir(__dirname);
        createFiles(testContainerPath, path.join(__dirname, "hierarchy_sample"));
        componentsGenerator = 
            new ComponentsGenerator(testContainerPath, { 
                componentsFolder: "components",
                componentPattern: "*.generated.*", 
                referencesFile: "projectsettings.csproj", 
                resourcesFile: "properties/assemblyInfo.cs",
                postfixes: ["-v3", "-v4"]
            });
    });
    afterEach(function () {
        deleteFolderRecursive(testContainerPath);
    });
    describe("updateProjectReferences", function () {
        beforeEach(function() {
            componentsGenerator.updateProjectReferences();
        });
        xit("adds resource files", function() {
            expect(getContent("projectsettings.csproj")).toBe(`<?xml version="1.0" encoding="utf-8"?>
            <Project>
              <ItemGroup>
                <EmbeddedResource Include="components/c1.generated.js" />
                <EmbeddedResource Include="components/c1-v3.generated.css" />
                <EmbeddedResource Include="components/c1-v4.generated.css" />
                <Compile Include="components/c1.generated.cs" />
              </ItemGroup>
            </Project>`);
        });
        xit("removes deleted components", function() {
            componentsGenerator.settings.postfixes = [];
            componentsGenerator.updateProjectReferences();
            expect(getContent("projectsettings.csproj")).toBe(`<?xml version="1.0" encoding="utf-8"?>
            <Project>
              <ItemGroup>
                <EmbeddedResource Include="components/c1.generated.js" />
                <Compile Include="components/c1.generated.cs" />
              </ItemGroup>
            </Project>`);
        });
    });
    describe("updateProjectResources", function () {
        beforeEach(function() {
            componentsGenerator.updateProjectResources();
        });
        it("adds resource files", function() {
            expect(getContent("properties/assemblyInfo.cs")).toBe(
`[assembly: WebResource(Components.c1.c1-v3_CssResourceName, "text/css")]
[assembly: WebResource(Components.c1.c1-v4_CssResourceName, "text/css")]
[assembly: WebResource(Components.c1.c1_JavascriptResourceName, "text/javascript")]`);
        });
        it("removes deleted components", function() {
            componentsGenerator.settings.postfixes = [];
            componentsGenerator.updateProjectResources();
            expect(getContent("properties/assemblyInfo.cs")).toBe(
                `[assembly: WebResource(Components.c1-v3.c1-v3_CssResourceName, "text/css")]
[assembly: WebResource(Components.c1-v4.c1-v4_CssResourceName, "text/css")]
[assembly: WebResource(Components.c1.c1_JavascriptResourceName, "text/javascript")]`);
        });
    });
});