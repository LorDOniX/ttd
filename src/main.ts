import './style.css';
import { takeLaunchIntent } from './game/launch';
import { DEFAULT_OPTIONS, runGame } from './screens/game';
import { runTitle } from './screens/title';
import { runAllModels } from './screens/allModels';
import { runGameAssets } from './screens/gameAssets';
import { applyTheme, loadTheme } from './ui/theme';

applyTheme(loadTheme());

const container = document.getElementById('app')!;
const route = location.pathname.replace(/\/$/, '');
if (route === '/all-models') {
  runAllModels(container);
} else if (route === '/game-assets') {
  runGameAssets(container);
} else {
  const intent = takeLaunchIntent();
  // ?seed=... v URL spustí rovnou novou hru (zkratka pro ladění)
  const urlSeed = new URLSearchParams(location.search).get('seed');

  if (intent) runGame(container, intent);
  else if (urlSeed) runGame(container, { mode: 'new', options: { seedText: urlSeed, ...DEFAULT_OPTIONS } });
  else runTitle(container);
}
