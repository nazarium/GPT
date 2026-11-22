import { hydrateRoot } from 'react-dom/client';
import { App } from './App.jsx';

const page = JSON.parse(document.getElementById('page-data').textContent);
hydrateRoot(document.getElementById('app'), <App page={page} />);
