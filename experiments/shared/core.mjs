export const EXPERIMENTS = Object.freeze([
  { id: 'liquid-identity', title: 'Liquid Identity', material: 'Magnetic ink', gesture: 'Pull the initials apart. Let them find their way back.' },
  { id: 'wet-ink', title: 'Wet-ink Usman', material: 'Ink on water', gesture: 'Stir a portrait into something entirely your own.' },
  { id: 'honey-plotter', title: 'Honey Plotter', material: 'Viscous thread', gesture: 'Slow the belt. Watch a line become a little less predictable.' },
  { id: 'singing-sand', title: 'Singing Sand', material: 'Vibrating grains', gesture: 'Change the frequency. Find a shape you could not draw.' },
  { id: 'pin-art', title: 'Pin-art Portrait', material: 'Spring-loaded pins', gesture: 'Leave an impression. The portrait will remember itself.' },
].map(Object.freeze));

export function neighbours(id) {
  const index = EXPERIMENTS.findIndex(item => item.id === id);
  if (index === -1) throw new RangeError(`Unknown experiment: ${id}`);
  return {
    current: EXPERIMENTS[index],
    previous: EXPERIMENTS[(index + EXPERIMENTS.length - 1) % EXPERIMENTS.length],
    next: EXPERIMENTS[(index + 1) % EXPERIMENTS.length],
    index,
  };
}
