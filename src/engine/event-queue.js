// Stable min-heap. Equal-time events run in insertion order.
function earlier(a, b) {
  return a.time < b.time || (a.time === b.time && a.order < b.order)
}

export class EventQueue {
  items = []
  sequence = 0

  add(time, type, loader = null, point = null) {
    const event = { time, type, loader, point, order: this.sequence++ }
    const items = this.items
    let i = items.length
    items.push(event)
    while (i > 0) {
      const parent = (i - 1) >>> 1
      if (!earlier(event, items[parent])) break
      items[i] = items[parent]
      i = parent
    }
    items[i] = event
  }

  pop() {
    const items = this.items
    const first = items[0]
    const last = items.pop()
    if (items.length) {
      let i = 0
      while (2 * i + 1 < items.length) {
        let child = 2 * i + 1
        if (child + 1 < items.length && earlier(items[child + 1], items[child])) child++
        if (!earlier(items[child], last)) break
        items[i] = items[child]
        i = child
      }
      items[i] = last
    }
    return first
  }
}
