import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ALLOWED_INTERNAL_ROUTES,
  DEFAULT_PROJECT_LIST_VIEW_STATE,
  MAX_QUERY_LENGTH,
  MAX_RETURN_URL_LENGTH,
  PROJECT_DETAIL_TABS,
  appendReturnContext,
  clampSearchQuery,
  createEnumCodec,
  createTextCodec,
  diskUsagePrefsCodec,
  formatProjectListUrl,
  makeViewStateKey,
  mergeProjectListUrlOverrides,
  normalizeResourceKey,
  projectDetailTabCodec,
  projectListViewCodec,
  readProjectListUrlOverrides,
  resolveReturnTarget,
  validateOriginEntryId,
  validateReturnTarget,
} from "./navigation-targets.ts"

test("makeViewStateKey and normalizeResourceKey preserve lexical Windows/Unicode paths", () => {
  assert.equal(normalizeResourceKey(undefined), "")
  assert.equal(normalizeResourceKey(null), "")
  assert.equal(normalizeResourceKey("  D:\\TEST\\Thư mục\\app  "), "D:\\TEST\\Thư mục\\app")
  assert.equal(
    makeViewStateKey("project-detail", "D:\\TEST\\app"),
    "project-detail::D:\\TEST\\app",
  )
  assert.equal(makeViewStateKey("projects"), "projects::")
})

test("validateReturnTarget accepts allowed same-origin routes with Windows & Unicode params", () => {
  for (const route of ALLOWED_INTERNAL_ROUTES) {
    assert.equal(validateReturnTarget(route), route)
  }
  const winTarget = "/projects?path=D%3A%5CTEST%5CTh%C6%B0+m%E1%BB%A5c+%23%26%2B%25%3F"
  assert.equal(validateReturnTarget(winTarget), winTarget)
  assert.equal(validateReturnTarget("/?q=widget&sort=name"), "/?q=widget&sort=name")
  assert.equal(
    validateReturnTarget("/disk-usage?path=D%3A%5Capp%5Cnode_modules&view=packages"),
    "/disk-usage?path=D%3A%5Capp%5Cnode_modules&view=packages",
  )
})

test("validateReturnTarget rejects external, protocol-relative, script, backslash-path, control, unknown, and oversized URLs", () => {
  const invalid = [
    "",
    "   ",
    null,
    undefined,
    123,
    "https://evil.example/projects",
    "http://127.0.0.1:24680/projects",
    "//evil.example/projects",
    "/\\evil.example/projects",
    "javascript:alert(1)",
    "data:text/html,hi",
    "\\projects",
    "/projects\\sub",
    "/projects\n",
    "/projects\u0000",
    "/api/scans",
    "/admin",
    "/../etc/passwd",
    "//",
    `/?q=${"a".repeat(MAX_RETURN_URL_LENGTH)}`,
  ]
  for (const candidate of invalid) {
    assert.equal(validateReturnTarget(candidate), null, `expected null for ${String(candidate)}`)
  }
})

test("validateReturnTarget drops hashes and bounds nested returnTo chains", () => {
  assert.equal(validateReturnTarget("/projects?path=D%3A%5Ca#section"), "/projects?path=D%3A%5Ca")
  const inner = "/projects?path=D%3A%5Ca&returnTo=%2F%3Fq%3Ddeep"
  const outer = `/disk-usage?path=D%3A%5Ca%5Cnm&returnTo=${encodeURIComponent(inner)}`
  const validated = validateReturnTarget(outer)
  assert.ok(validated && validated.startsWith("/disk-usage?"))
  const hugeInner = `/projects?path=D%3A%5Ca&returnTo=${encodeURIComponent(`/?q=${"x".repeat(3800)}`)}`
  const bounded = validateReturnTarget(`/disk-usage?path=D%3A%5Ca&returnTo=${encodeURIComponent(hugeInner)}`)
  assert.ok(bounded === null || bounded.length <= MAX_RETURN_URL_LENGTH)
})

test("appendReturnContext and resolveReturnTarget roundtrip origin and fall back safely", () => {
  assert.equal(validateOriginEntryId("entry-1_abc"), "entry-1_abc")
  assert.equal(validateOriginEntryId("../bad"), null)
  assert.equal(validateOriginEntryId("a".repeat(65)), null)

  const link = appendReturnContext("/projects?path=D%3A%5CTEST", {
    returnTo: "/?q=pkg&sort=name",
    originId: "entry-42",
  })
  const resolved = resolveReturnTarget(new URL(link, "http://127.0.0.1").searchParams, "/")
  assert.deepEqual(resolved, {
    href: "/?q=pkg&sort=name",
    originId: "entry-42",
    isFallback: false,
  })

  // Malicious returnTo falls back safely; self-loop also falls back.
  assert.deepEqual(
    resolveReturnTarget({ returnTo: "//evil.com", origin: "bad id!" }, "/projects?path=D%3A%5Ca"),
    { href: "/projects?path=D%3A%5Ca", originId: null, isFallback: true },
  )
  assert.deepEqual(
    resolveReturnTarget({ returnTo: "/projects?path=D%3A%5Ca" }, "/", "/projects?path=D%3A%5Ca"),
    { href: "/", originId: null, isFallback: true },
  )
})

test("projectListViewCodec encodes/decodes multi-array filters, migrates legacy scalars, and rejects malformed payloads", () => {
  assert.equal(clampSearchQuery("x".repeat(600)).length, MAX_QUERY_LENGTH)
  const valid = projectListViewCodec.decode({
    query: "x".repeat(600),
    sort: "name",
    filters: {
      managers: ["pnpm", "npm", "pnpm"],
      nodeModules: ["present"],
      activities: ["within7d", "olderThan365d"],
    },
  })
  assert.deepEqual(valid, {
    query: "x".repeat(MAX_QUERY_LENGTH),
    sort: "name",
    filters: {
      managers: ["pnpm", "npm"],
      nodeModules: ["present"],
      activities: ["within7d", "olderThan365d"],
    },
  })

  assert.deepEqual(
    projectListViewCodec.encode({
      query: "x".repeat(600),
      sort: "activity",
      filters: {
        managers: ["npm", "npm", "yarn"],
        nodeModules: ["missing", "missing"],
        activities: ["within30d"],
      },
    }),
    {
      query: "x".repeat(MAX_QUERY_LENGTH),
      sort: "activity",
      filters: {
        managers: ["npm", "yarn"],
        nodeModules: ["missing"],
        activities: ["within30d"],
      },
    },
  )

  // Legacy scalar migration in sessionStorage
  assert.deepEqual(
    projectListViewCodec.decode({
      query: "legacy",
      sort: "name",
      filters: { manager: "pnpm", nodeModules: "present", activity: "within7d" },
    }),
    {
      query: "legacy",
      sort: "name",
      filters: { managers: ["pnpm"], nodeModules: ["present"], activities: ["within7d"] },
    },
  )
  assert.deepEqual(
    projectListViewCodec.decode({
      query: "all",
      sort: "activity",
      filters: { manager: "all", nodeModules: "all", activity: "all" },
    }),
    {
      query: "all",
      sort: "activity",
      filters: { managers: [], nodeModules: [], activities: [] },
    },
  )
  assert.deepEqual(
    projectListViewCodec.decode({
      query: "unknown-mgr",
      sort: "activity",
      filters: { manager: "unknown", nodeModules: "bogus", activity: "legacy-removed" },
    }),
    {
      query: "unknown-mgr",
      sort: "activity",
      filters: { managers: ["unknown"], nodeModules: [], activities: [] },
    },
  )

  assert.equal(projectListViewCodec.decode("bad"), null)
  assert.equal(projectListViewCodec.decode({ query: 123, sort: "name", filters: {} }), null)
  assert.equal(projectListViewCodec.decode({ query: "ok", sort: "name", filters: {} }), null)
  assert.equal(
    projectListViewCodec.decode({
      query: "ok",
      sort: "name",
      filters: { managers: ["npm", "bogus"], nodeModules: [], activities: [] },
    }),
    null,
  )
  assert.equal(
    projectListViewCodec.decode({
      query: "ok",
      sort: "bogus",
      filters: DEFAULT_PROJECT_LIST_VIEW_STATE.filters,
    }),
    null,
  )
})

test("ProjectList URL override helpers handle multi-value params, legacy scalars, and strip defaults on reset", () => {
  const stored = {
    query: "stored",
    sort: "name",
    filters: { managers: ["npm"], nodeModules: ["present"], activities: ["within30d"] },
  }
  const overrides = readProjectListUrlOverrides("?q=url-hit&manager=invalid&activity=within7d")
  assert.deepEqual(overrides, { query: "url-hit", filters: { activities: ["within7d"] } })
  const merged = mergeProjectListUrlOverrides(stored, overrides)
  assert.deepEqual(merged, {
    query: "url-hit",
    sort: "name",
    filters: { managers: ["npm"], nodeModules: ["present"], activities: ["within7d"] },
  })

  // Comma-separated and repeated params, deduplicated, ignoring invalid tokens
  assert.deepEqual(
    readProjectListUrlOverrides("?manager=npm,pnpm,invalid,npm&nodeModules=present&nodeModules=missing&activities=within7d,olderThan365d"),
    {
      filters: {
        managers: ["npm", "pnpm"],
        nodeModules: ["present", "missing"],
        activities: ["within7d", "olderThan365d"],
      },
    },
  )
  assert.deepEqual(
    readProjectListUrlOverrides({ managers: ["yarn", "npm", "yarn"], activity: "all" }),
    { filters: { managers: ["yarn", "npm"], activities: [] } },
  )
  assert.deepEqual(
    readProjectListUrlOverrides("?manager=all"),
    { filters: { managers: [] } },
  )

  const multiState = {
    query: "app",
    sort: "name",
    filters: { managers: ["npm", "pnpm"], nodeModules: ["present"], activities: ["within7d"] },
  }
  const formatted = formatProjectListUrl("/", multiState, "?manager=legacy&activity=legacy&unrelated=1")
  const roundtrip = readProjectListUrlOverrides(formatted.slice(formatted.indexOf("?")))
  assert.deepEqual(roundtrip, {
    query: "app",
    sort: "name",
    filters: { managers: ["npm", "pnpm"], nodeModules: ["present"], activities: ["within7d"] },
  })
  assert.equal(new URL(formatted, "http://127.0.0.1").searchParams.get("unrelated"), "1")
  assert.equal(new URL(formatted, "http://127.0.0.1").searchParams.has("manager"), false)
  assert.equal(new URL(formatted, "http://127.0.0.1").searchParams.has("activity"), false)

  // Clearing filters/query strips only cleared params (including legacy ones); preserving sort writes sort=name.
  const afterClear = { ...DEFAULT_PROJECT_LIST_VIEW_STATE, sort: "name" }
  assert.equal(formatProjectListUrl("/", afterClear, "?q=url-hit&activity=within7d&activities=within7d&unrelated=1"), "/?unrelated=1&sort=name")
  assert.equal(formatProjectListUrl("/", DEFAULT_PROJECT_LIST_VIEW_STATE, "?q=url-hit&sort=name&managers=npm"), "/")
})

test("projectDetailTabCodec validates detail tabs and rejects unknown values", () => {
  assert.deepEqual(PROJECT_DETAIL_TABS, ["overview", "files", "disk"])
  for (const tab of PROJECT_DETAIL_TABS) {
    assert.equal(projectDetailTabCodec.encode(tab), tab)
    assert.equal(projectDetailTabCodec.decode(tab), tab)
  }
  for (const invalid of ["other", "", null, undefined, 123, ["overview"]]) {
    assert.equal(projectDetailTabCodec.decode(invalid), null)
  }
})

test("reusable codecs validate enums, clamped text, and lightweight disk usage prefs", () => {
  const sortCodec = createEnumCodec(1, ["size", "name"])
  assert.equal(sortCodec.decode("name"), "name")
  assert.equal(sortCodec.decode("unknown"), null)

  const queryCodec = createTextCodec(1, 10)
  assert.equal(queryCodec.decode("abcdefghijkl"), "abcdefghij")
  assert.equal(queryCodec.decode(99), null)

  const prefs = diskUsagePrefsCodec.decode({
    path: "D:\\TEST\\nm",
    view: "packages",
    hasMeasuredRef: true,
    ancestorCount: 3,
  })
  assert.deepEqual(prefs, {
    path: "D:\\TEST\\nm",
    view: "packages",
    hasMeasuredRef: true,
    ancestorCount: 3,
  })
  assert.equal(diskUsagePrefsCodec.decode({ path: "D:\\a", view: "invalid" }), null)
})
