/**
 * jest-dom matchers (toBeInTheDocument, toHaveValue, …) are installed at
 * runtime by vitest's `setupFiles`; this reference gives `tsc --noEmit` the
 * same types. It lives here because tsconfig.json now type-checks the
 * component tests (the .tsx files under test/), which are the ones using
 * the matchers.
 */
/// <reference types="@testing-library/jest-dom/vitest" />
