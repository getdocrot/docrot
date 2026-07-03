# mono-root

Docs import from a workspace package whose entry re-exports a sibling
workspace package — the `@playwright/test` shape.

```js
import { realBeta, BETA_CONST } from '@mono/alpha';

realBeta('hello');
```

```js
import { ghostBeta } from '@mono/alpha';
```
