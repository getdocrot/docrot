# fixture-pkg

A fixture package with deliberately rotten docs.

## Install

```bash
npm install fixture-pkg
npm run build
```

```bash
npm install fixture-pk
npm run deploy
npm run biuld
npx fixtur
```

## Usage

```js
import { realFn, REAL_CONST } from 'fixture-pkg';

realFn('hello');
```

```js
import { fakeFn } from 'fixture-pkg';

fakeFn();
```

```js
import { helper } from 'fixture-pkg/utils';
```

```js
import express from 'express';
```

## Config

```json
{ "valid": true }
```

```json
{ invalid json, }
```

```js
const answer: number = 42;
```

## Regression

The next block is mangled:

```js
function broken( {
```

This one just forgot its commas:

```js
const cfg = {
  a: 1
  b: 2
};
```

## Partial

```js
app.use(
  // ...
```

```js
.option('-d, --debug')
.option('-v, --verbose')
```

```ts
export type MyType<Value extends string> = ... // omitted
```

```ts
while (g && (g = 0, op[0] && (_ = 0)), _) try ...
```

```js
case 0: // next
case 1: // throw
default:
```

```js
const result = lib.scan('!./foo/*.js');
console.log(result);
{ prefix: '!./',
  input: '!./foo/*.js',
  isGlob: true }
```

```js
const result = lib.parse(pattern[, options]);
```

```bash
npm run <command> -- --flag
cd elsewhere && npm run sitedev
```

```js
interface Identifier <: Expression, Pattern {
  type: "Identifier";
  name: string;
}
enum Kind { "var" | "let" }
```

```js
a// 1
/* 2 */
 + <!-- 3
-->
2;
```

```js
{ foo: 1 }

// or
{ 'foo': 1 }
```

```json
{
  // jsonc comment
  "list": [1, 2,],
}
```

Examples of **incorrect** code for this rule:

```js
const broken = = 2;
```

```js
.
├── one/
└── file.js
```

```js
"this string is invalid: \u"
```

```js
node file.js
zx build.mjs
```

```js
headers.get('Abc') =>            headers.get('Abc')
'string'                         'string'
res.body                         res.body.pipe(x)
```

```js
const style: $Exact<CSS.Properties<*>> = {
  [('--theme-color': any)]: 'black',
};
```

```js
e + b = (k1 & 0xffff) * (c1 & 0xffff)
e + b = k1 * (c1 & 0xffff)
```

```js
// zx
zx file.js

// or node
node file.js
```

```js
  '.a',
  '.b',
```

```js
connect(req, opts) {
  return net.connect(opts);
}
});
```

```json
{ "version": 3 }

{ "version": 4 }
```

```js
"before": "always" or "never"
```

<!-- docrot-ignore -->
```js
this is (definitely not valid
```

## Links

- [setup guide](./docs/guide.md)
- [missing page](./docs/nope.md)
- [anchor ok](./docs/guide.md#getting-started)
- [anchor bad](./docs/guide.md#instalation)
- [anchor typo](./docs/guide.md#getting-startd)
- [self anchor](#usage)

![logo](./img/logo.png)
