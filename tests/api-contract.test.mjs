import {test} from "node:test";
import assert from "node:assert/strict";
test("health endpoint refuses unsupported methods", async () => {
  const {default:handler}=await import("../api/v1/health.js");
  const response={statusCode:0,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
  await handler({method:"POST"},response);
  assert.equal(response.statusCode,405);
  assert.equal(response.body.error.code,"METHOD_NOT_ALLOWED");
});
test("health endpoint does not claim readiness without Supabase config", async () => {
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  const {default:handler}=await import("../api/v1/health.js");
  const response={statusCode:0,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
  await handler({method:"GET"},response);
  assert.equal(response.statusCode,503);
  assert.equal(response.body.success,false);
});
