# unres-pkg

The package's own types re-export a dependency that is not installed in a
bare clone, so "mysteryFn is missing" cannot be asserted with confidence.

```js
import { mysteryFn } from 'unres-pkg';
```
