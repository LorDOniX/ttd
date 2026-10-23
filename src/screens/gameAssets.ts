import { assetModels } from 'virtual:asset-model-catalog';
import { ROAD_VEHICLE_MODELS, TRAIN_MODELS } from '../game/balance';
import { CARGO_TYPES, CARGOS } from '../game/cargo';
import { CITY_CAR_MODELS } from '../game/cityTraffic';
import type { Kit } from '../assets';
import { ANIMAL_MODELS } from '../render/animals';
import { INDUSTRY_ASSET_MODELS } from '../render/industries';
import { buildIndustryPreview } from '../render/industries';
import { CHARACTER_MODELS } from '../render/pedestrians';
import { TREE_MODELS } from '../render/trees';
import { TOWN_BUILDING_MODELS } from '../world/town';
import { INDUSTRY_TYPES, type IndustryKind } from '../world/industry';
import { runModelGallery, type GalleryModel } from './allModels';

const assetKeys = new Set(assetModels.map((model) => `${model.kit}/${model.name}`));

function usedModels(): GalleryModel[] {
  const models = new Map<string, GalleryModel>();
  const add = (kit: Kit, name: string, category: string): void => {
    const key = `${kit}/${name}`;
    if (assetKeys.has(key) && !models.has(key)) models.set(key, { kit, name, category });
  };

  for (const model of TRAIN_MODELS) {
    add('train kit', model.model, 'Lokomotivy');
    add('train kit', model.wagonModel, 'Vagony');
  }
  for (const cargo of CARGO_TYPES) {
    for (const wagon of CARGOS[cargo].wagonModels ?? []) add('train kit', wagon, 'Vagony');
  }
  for (const model of ROAD_VEHICLE_MODELS) add('car kit', model.model, 'Silniční vozidla');
  for (const model of CITY_CAR_MODELS) add('car kit', model, 'Městská auta');
  for (const model of TREE_MODELS) add('nature kit', model, 'Stromy');
  for (const model of ANIMAL_MODELS) add('cube pets', model, 'Zvířata');
  for (const model of CHARACTER_MODELS) add('blocky characters', model, 'Chodci');
  for (const model of TOWN_BUILDING_MODELS) {
    add(model.startsWith('building-type-') ? 'city kit suburban' : 'city kit commercial', model, 'Městské budovy');
  }
  for (const model of INDUSTRY_ASSET_MODELS) add(model.kit, model.name, 'Průmyslové areály');
  add('car kit', 'tractor-shovel', 'Stavební ikony');

  const components = [...models.values()];
  const completeIndustries: GalleryModel[] = (Object.keys(INDUSTRY_TYPES) as IndustryKind[]).map((kind) => ({
    kit: 'Sestava hry',
    name: INDUSTRY_TYPES[kind].name,
    category: 'Kompletní průmyslové areály',
    preview: () => buildIndustryPreview(kind),
  }));
  return [...components, ...completeIndustries].sort(
    (a, b) => a.category!.localeCompare(b.category!) || a.kit.localeCompare(b.kit) || a.name.localeCompare(b.name),
  );
}

export function runGameAssets(container: HTMLElement): void {
  runModelGallery(container, usedModels(), 'Modely použité ve hře', 'Všechny skupiny', 'skupin');
}
