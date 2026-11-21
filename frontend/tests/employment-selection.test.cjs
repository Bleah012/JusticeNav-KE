const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");

// Exercise the components' rendered controls and handlers without a browser or live services.
function renderer() {
  const states = new Map();
  let slots = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      const state = slots;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect() {},
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  return { hooks, render(Component, props) {
    if (!states.has(Component)) states.set(Component, []);
    slots = states.get(Component);
    cursor = 0;
    return Component(props);
  } };
}
const jsx = (type, props) => ({ type, props: props ?? {} });
function load(relative, hooks, mocks = {}) {
  const file = path.resolve(__dirname, "../src", relative);
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, AbortController, URL, URLSearchParams,
    FormData: class { constructor(values) { this.values = values; } get(name) { return this.values[name] ?? null; } },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "../assessments/assessmentApi") return load("assessments/assessmentApi.ts", hooks);
      if (name.endsWith(".css")) return {};
      // Imported presentation components are left as elements; only the component under test runs.
      return new Proxy({}, { get: (_target, key) => String(key) });
    },
  }, { filename: file });
  return mod.exports;
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object" || !tree.props) return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
function one(tree, predicate) {
  const matches = nodes(tree, predicate);
  assert.equal(matches.length, 1);
  return matches[0];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree && typeof tree === "object" ? text(tree.props?.children) : tree == null || tree === false ? "" : String(tree);
}
const ID = "a".repeat(32);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function clarification() {
  const formRenderer = renderer(), calls = [], destinations = [];
  const saved = { revision: 2, description: "My employer has not paid me", answers: { issue: "other", timeframe: "recent", contact: "no" } };
  const editor = {
    state: { status: "ready", value: saved, saving: false, needsReload: false },
    api: {
      suggestIssue: async (...args) => { calls.push(["suggest", ...args]); return "employment"; },
      save: async (...args) => { calls.push(["save", ...args]); return { ...saved, answers: args[1].answers, revision: 3 }; },
    },
    resource: { mutate: (operation) => operation(saved, new AbortController().signal) },
  };
  const { AssessmentClarificationPage } = load("pages/AssessmentClarificationPage.tsx", formRenderer.hooks, {
    "react-router": { Link: "link", useParams: () => ({ assessmentId: ID }), useNavigate: () => (url) => destinations.push(url) },
    "../auth/useAuth": { useAuth: () => ({ session: { status: "ready", identity: { uid: "owner" } } }) },
    "../assessments/useAssessment": { useAssessmentRecord: () => editor },
  });
  const account = AssessmentClarificationPage();
  const form = one(account.type(account.props), (node) => node.type.name === "ClarificationForm");
  return { render: () => formRenderer.render(form.type, form.props), renderComponent: formRenderer.render, calls, destinations, saved };
}
const issueRadio = (tree, issue) => one(tree, (node) => node.type === "input" && node.props.name === "clarification-issue" && node.props.value === issue);
const submit = (tree) => one(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { getAttribute: () => "continue" } } });

test("manual Employment selection replaces Other only after user input and saves the selected category", async () => {
  const form = clarification();
  let tree = form.render();
  assert.equal(issueRadio(tree, "other").props.checked, true);
  assert.equal(issueRadio(tree, "employment").props.checked, false);
  assert.equal(form.saved.answers.issue, "other");
  assert.equal(form.calls.length, 0);
  issueRadio(tree, "employment").props.onChange();
  tree = form.render();
  assert.equal(issueRadio(tree, "employment").props.checked, true);
  assert.equal(issueRadio(tree, "other").props.checked, false);
  assert.equal(form.calls.length, 0);
  await submit(tree);
  const [kind, id, update, revision] = form.calls[0];
  assert.equal(kind, "save");
  assert.equal(id, ID);
  assert.equal(update.answers.issue, "employment");
  assert.equal(update.proceed, true);
  assert.equal(revision, 2);
  assert.deepEqual(form.destinations, [`/app/assessments/${ID}/results`]);
});

test("an Employment suggestion displays its label and changes the choice only when applied", async () => {
  const form = clarification();
  const suggestion = one(form.render(), (node) => node.type.name === "IssueSuggestion");
  let tree = form.renderComponent(suggestion.type, suggestion.props);
  one(tree, (node) => node.props.children === "Suggest a category").props.onClick();
  await tick();
  tree = form.renderComponent(suggestion.type, suggestion.props);
  assert.equal(text(one(tree, (node) => node.type === "strong")), "Employment");
  assert.equal(form.calls[0][0], "suggest");
  assert.equal(form.calls[0][1], ID);
  assert.equal(form.calls[0][2], 2);
  assert.equal(issueRadio(form.render(), "other").props.checked, true);
  assert.equal(form.calls.length, 1);
  one(tree, (node) => node.props.children === "Use this category").props.onClick();
  tree = form.render();
  assert.equal(issueRadio(tree, "employment").props.checked, true);
  await submit(tree);
  assert.equal(form.calls[1][2].answers.issue, "employment");
});

test("Employment results use the saved selection label and link to the employment guide", () => {
  const published = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../backend/app/public_pathways.json"), "utf8"));
  const pathway = published.pathways.find((item) => item.id === "employment-dispute-information");
  const { AssessmentResultsPage } = load("pages/AssessmentResultsPage.tsx", renderer().hooks);
  const tree = AssessmentResultsPage({ assessmentId: ID, results: { status: "ready", navigation: {
    selectedIssue: "employment", revision: 2, checkedOn: published.checkedOn, pathways: [{ pathway, reason: "You selected Employment." }],
  } } });
  assert(text(tree).includes("Information linked to your saved Employment selection."));
  assert.equal(one(tree, (node) => node.props.children === "View pathway").props.to, `/pathways/employment-dispute-information?assessmentId=${ID}`);
});

test("employment resource filtering follows URL selection and preserves other query parameters", () => {
  let params = new URLSearchParams("category=employment&view=cards");
  const ui = renderer();
  const { ResourcesPage } = load("pages/ResourcesPage.tsx", ui.hooks, {
    "react-router": { useSearchParams: () => [params, (next) => { params = next; }] },
  });
  const props = { library: { status: "ready", resources: [
    { id: "employment", title: "Employment guide", description: "Employment", categories: ["employment"], source: { name: "Judiciary", url: "https://judiciary.go.ke/", checkedOn: "2026-11-21" } },
    { id: "consumer", title: "Consumer guide", description: "Consumer", categories: ["consumer"], source: { name: "CAK", url: "https://cak.go.ke/", checkedOn: "2026-11-03" } },
  ] } };
  let tree = ui.render(ResourcesPage, props);
  assert.equal(one(tree, (node) => node.type === "input" && node.props.value === "employment").props.checked, true);
  assert(text(tree).includes("Employment guide"));
  assert(!text(tree).includes("Consumer guide"));
  one(tree, (node) => node.type === "input" && node.props.value === "all").props.onChange();
  assert.equal(params.has("category"), false);
  assert.equal(params.get("view"), "cards");
  tree = ui.render(ResourcesPage, props);
  assert(text(tree).includes("Consumer guide"));
  one(tree, (node) => node.type === "input" && node.props.value === "employment").props.onChange();
  assert.equal(params.get("category"), "employment");
});

test("admin pathway category choices include Employment and preserve existing custom categories", () => {
  const ui = renderer();
  const { PathwayManagementView } = load("components/PathwayManagement.tsx", ui.hooks, {
    "react-router": { Link: "link", useNavigate: () => () => {} },
  });
  const pathway = { id: "existing-guide", category: "Existing custom category", startingSteps: [], preparation: [], matters: [], requirements: [], nextStages: [], sourceReview: { checkedOn: "2026-11-21", sources: [] } };
  const resource = { snapshot: () => ({ status: "ready", value: { records: [{ pathway, revision: 1 }], publishedServices: [] } }) };
  const page = ui.render(PathwayManagementView, { resource, mode: "edit", pathwayId: pathway.id });
  const form = one(page, (node) => node.type.name === "PathwayForm");
  const tree = ui.render(form.type, form.props);
  const category = one(tree, (node) => node.type === "input" && node.props.name === "category");
  assert.equal(category.props.defaultValue, pathway.category);
  const choices = one(tree, (node) => node.type === "datalist" && node.props.id === category.props.list);
  assert.equal(one(choices, (node) => node.type === "option" && node.props.value === "Employment").props.value, "Employment");
});
