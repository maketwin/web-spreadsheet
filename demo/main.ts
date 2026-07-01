import { Spreadsheet } from '../src/index';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('Demo root element not found.');
}

const spreadsheet = new Spreadsheet(root, {
  data: [
    [{ text: 'A1' }, { text: 'B1' }],
    [{ text: 'A2' }, { text: 'B2' }],
  ],
});

spreadsheet.mount();
