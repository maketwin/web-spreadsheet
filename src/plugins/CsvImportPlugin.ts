import type { Plugin } from '../plugin/PluginManager';

export const CsvImportPlugin: Plugin = {
  name: 'csv-import',
  install(api) {
    api.on('csv:import', (payload) => {
      const csv = String(payload);
      const lines = csv.split('\n').filter((line) => line.trim() !== '');
      for (let r = 0; r < lines.length; r += 1) {
        const line = lines[r];
        if (line === undefined) continue;
        const cells = line.split(',');
        for (let c = 0; c < cells.length; c += 1) {
          const text = cells[c];
          if (text === undefined) continue;
          api.store.setCell(r, c, { text: text.trim() });
        }
      }
    });
  },
};
