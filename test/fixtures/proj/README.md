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

## Broken

```js
function broken( {
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
- [self anchor](#usage)

![logo](./img/logo.png)
