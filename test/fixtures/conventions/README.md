# conv-pkg

Documentation conventions that must not be reported as rot.

## typedoc member notation

```ts
optional injector: Injector;
```

```ts
optional initialData:
  | InitialDataFunction<NonUndefinedGuard<TQueryFnData>>
| NonUndefinedGuard<TQueryFnData>;
```

## twoslash annotations declare their own errors

```js
// @errors: 1005
for (;;) {
```

## diff highlight markers

```js
function foo(+++getBar+++) {
	return (node) => {
		+++console.log(getBar());+++
	};
}
```

## jsx sibling variants

```tsx
<Btn />
<Btn variant="primary" />
<Btn size="lg" /> // large
```

```jsx
import { Star } from './star.js';

<Star />
<Star filled />
```

## jsx attribute snippet

```tsx
getValueProps={() => ({ value: names.map((name) => form.getFieldValue(name)) })}
```

## one expression per line

```ts
[1, ...[2, 3], 4]
[...[a, b]]
```

## before and after property listings

```js
// Before (Express)
app.get("/api/users", handler);

// After (Bun)
"/api/users": {
  GET() { return Response.json(users); }
}
```

## diffs fenced as code

```js
-import react from '@vitejs/plugin-react'
+import react from '@react-router/dev/vite'
export default react
```

## jsx siblings separated by comments that mention `<tags>`

```tsx
import Link from './link.js';

// Old: `<a>` has to be nested inside
<Link href="/about">
  <a>About</a>
</Link>

// New: `<a>` can be omitted
<Link href="/about">
  About
</Link>
```

## ellipsis placeholder inside jsx

```tsx
renderToString(<StaticProvider ... />);
```

## convention pages named after files

Read the [client entry docs](./special.tsx) for details.

## ts fence containing jsx

```ts
export default function Page() {
  return <h1>Hello!</h1>
}
```

## js fence containing type-only syntax

```js
const identity = <T,>(value: T) => value
```

## ellipsis-wrapped placeholder

```js
...code...
```

## walkthrough continuation with a statement before a case

```ts
const tracked = new Set<number>();

// Later, inside the reducer switch:
case 'DeclareContext':
  if (!isFunctionExpression) {
    tracked.add(value.id);
  }
  break;
```

## diff inside a json fence

```json
{
  "devDependencies": {
-    "vite": "npm:rolldown-vite@latest"
+    "vite": "^8.0.0"
  }
}
```

## js object literal labeled json

```json
{ slug: ["a", "b"] }
```

## scaffold instructions leave the repo

```bash
npm create demo-app@latest my-app
cd my-app
```

```bash
npm run dev
npm run bild
```

## npm start falls back to server.js

```bash
npm start
```

## python placeholders

```python
@app.command()
def main(name: str = "World"):
    # Some code here
```

```python {lint="skip" test="skip"}
{
    'function': <function Model.serialize_foo at 0x111>,
    'is_field_serializer': True,
}
```

```python
# requirements.txt

numpy==2.2.4
polars-xdt==0.16.8
```

```python
q1 = lf.sink_parquet(.., lazy=True)
q2 = lf.sink_ipc(.., lazy=True)
```

```python
from rick_portal_gun.main import # something goes here
```

## control block

The next snippet has a typo in its signature:

```python
def genuinely_typoed(:
    pass
```

## links that only exist after a site build

See [tooltip attributes](b.html#tooltip-options) for details.

## control: a dead link outside any site tree

[really gone](./definitely-not-here.md)
