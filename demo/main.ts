import { Spreadsheet } from '../src/index';

const spreadsheet = new Spreadsheet('root', {
  data: [
    ['Name', 'Role', 'Status'],
    ['Alice', 'Designer', 'Active'],
    ['Bob', 'Engineer', 'Active'],
  ],
});

spreadsheet.mount();
