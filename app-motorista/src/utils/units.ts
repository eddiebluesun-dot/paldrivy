const MI_PER_METER = 0.000621371;
const GAL_PER_ML = 0.000264172;

export const metersToDisplay = (meters: number, unit: 'km' | 'mi'): number =>
  unit === 'km' ? meters / 1000 : meters * MI_PER_METER;

export const displayToMeters = (value: number, unit: 'km' | 'mi'): number =>
  unit === 'km' ? Math.round(value * 1000) : Math.round(value / MI_PER_METER);

export const mlToDisplay = (ml: number, unit: 'liters' | 'gallons'): number =>
  unit === 'liters' ? ml / 1000 : ml * GAL_PER_ML;

export const displayToMl = (value: number, unit: 'liters' | 'gallons'): number =>
  unit === 'liters' ? Math.round(value * 1000) : Math.round(value / GAL_PER_ML);
