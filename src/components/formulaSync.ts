import { useEffect } from 'react';
import type { FormulaEngine } from '../formula/FormulaEngine';
import type { Store } from '../store/Store';
import { createFormulaSync } from '../formula/formulaSync';

export { createFormulaSync } from '../formula/formulaSync';

export function useFormulaSync(store: Store, formulaEngine: FormulaEngine | undefined): void { useEffect(() => { if (formulaEngine === undefined) return undefined; return createFormulaSync(store, formulaEngine).unsubscribe; }, [store, formulaEngine]); }
