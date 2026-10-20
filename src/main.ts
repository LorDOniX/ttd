import './style.css';
import { takeLaunchIntent } from './game/launch';
import { DEFAULT_OPTIONS, runGame } from './screens/game';
import { runTitle } from './screens/title';

const container = document.getElementById('app')!;
const intent = takeLaunchIntent();
// ?seed=... v URL spustí rovnou novou hru (zkratka pro ladění)
const urlSeed = new URLSearchParams(location.search).get('seed');

if (intent) runGame(container, intent);
else if (urlSeed) runGame(container, { mode: 'new', options: { seedText: urlSeed, ...DEFAULT_OPTIONS } });
else runTitle(container);
