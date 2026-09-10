import { addRoad, createCity, deleteRoad, moveNode, rebuildCity, sculpt, setRiver, splitRoad, validateCity, type City } from './core/model';

self.onmessage = (event: MessageEvent) => {
  const { action, city, args } = event.data;
  const start = performance.now();
  try {
    let result: City;
    switch (action) {
      case 'create': result = createCity(args.example, args.seed); break;
      case 'road': result = addRoad(city, args.points, args.options); break;
      case 'move': result = moveNode(city, args.id, args.point); break;
      case 'delete': result = deleteRoad(city, args.id); break;
      case 'split': result = splitRoad(city, args.id, args.point); break;
      case 'river': result = setRiver(city, args.points, args.width, args.level); break;
      case 'sculpt': {
        result = city;
        for (const point of args.points) result = sculpt(result, point, args.radius, args.strength, args.mode, args.height);
        break;
      }
      case 'import':
        if (JSON.stringify(args.value).length > 8_000_000) throw new Error('This file exceeds the 8 MB studio document limit.');
        result = validateCity(args.value); break;
      case 'validate': result = validateCity(city); break;
      default: result = rebuildCity(city);
    }
    if (result.roads.length > 600 || result.buildings.length > 3000 || result.nodes.length > 1200 || result.terrain.resolution > 65) throw new Error('Studio capacity reached: 600 road segments, 3,000 buildings, 1,200 nodes, and a 65 x 65 heightfield. Simplify the city before continuing.');
    self.postMessage({ city: result, milliseconds: performance.now() - start });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
