declare module 'virtual:asset-model-catalog' {
  export interface AssetModelEntry {
    kit: string;
    name: string;
  }

  export const assetModels: AssetModelEntry[];
}
