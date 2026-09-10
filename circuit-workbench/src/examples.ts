import { createComponent, emptyDocument } from "./model";
import { junction, pin } from "./types";
import type { CircuitDocument, ComponentType, Endpoint, Point } from "./types";

function circuit(title: string) {
  const doc = emptyDocument();
  doc.title = title;
  return {
    doc,
    component(
      type: ComponentType,
      id: string,
      x: number,
      y: number,
      value?: number,
      rotation = 0,
    ) {
      const c = createComponent(type, id, x, y);
      if (value !== undefined) c.value = value;
      c.rotation = rotation;
      doc.components.push(c);
      return c;
    },
    wire(a: Endpoint, b: Endpoint, bends: Point[] = []) {
      doc.wires.push({ id: `w${doc.wires.length + 1}`, a, b, bends });
    },
    label(id: string, name: string, anchor: Endpoint) {
      doc.labels.push({ id, name, anchor });
    },
    voltage(id: string, name: string, anchor: Endpoint, color = "#df704b") {
      doc.probes.push({ id, kind: "voltage", name, anchor, color });
    },
  };
}

export const examples: {
  id: string;
  title: string;
  description: string;
  create: () => CircuitDocument;
}[] = [
  {
    id: "divider",
    title: "Voltage divider",
    description:
      "A 10 V source and two 1 kOhm resistors. The four-way VOUT crossing is explicitly joined; the bridge at (460, 400) is not connected.",
    create() {
      const { doc, component, wire, label, voltage } =
        circuit("Voltage divider");
      component("voltage", "V1", 180, 300, 10, 90);
      component("resistor", "R1", 340, 180, 1000);
      component("resistor", "R2", 460, 300, 1000, 90);
      component("ground", "GND", 180, 460);
      doc.junctions.push(
        { id: "JOUT", x: 460, y: 180 },
        { id: "JVIN", x: 620, y: 400 },
      );
      wire(pin("V1", 0), pin("R1", 0), [{ x: 180, y: 180 }]);
      wire(pin("R1", 1), junction("JOUT"));
      wire(junction("JOUT"), pin("R2", 0));
      wire(pin("R2", 1), pin("GND", 0), [{ x: 460, y: 460 }]);
      wire(pin("V1", 1), pin("GND", 0));
      wire(pin("R1", 0), junction("JVIN"), [{ x: 300, y: 400 }]);
      doc.junctions.push(
        { id: "JTOP", x: 460, y: 100 },
        { id: "JRIGHT", x: 620, y: 180 },
      );
      wire(junction("JOUT"), junction("JTOP"));
      wire(junction("JOUT"), junction("JRIGHT"));
      label("LIN", "VIN", pin("R1", 0));
      label("LOUT", "VOUT", junction("JOUT"));
      voltage("PVIN", "Input", pin("R1", 0), "#78959c");
      voltage("PVOUT", "Output", junction("JOUT"));
      doc.probes.push({
        id: "PIR1",
        kind: "current",
        componentId: "R1",
        name: "R1 current",
        color: "#af9561",
      });
      doc.settings = {
        duration: 0.005,
        timestep: 0.00001,
        tolerance: 1e-8,
        initialization: "dc",
      };
      return doc;
    },
  },
  {
    id: "rc",
    title: "RC step response",
    description:
      "Charge a 1 uF capacitor through 1 kOhm from 5 V. Starts explicitly at zero; select DC initialization to start at the steady 5 V operating point.",
    create() {
      const { doc, component, wire, label, voltage } =
        circuit("RC step response");
      component("voltage", "V1", 180, 300, 5, 90);
      component("resistor", "R1", 340, 180, 1000);
      component("capacitor", "C1", 500, 300, 1e-6, 90).initial = 0;
      component("ground", "GND", 180, 440);
      wire(pin("V1", 0), pin("R1", 0), [{ x: 180, y: 180 }]);
      wire(pin("R1", 1), pin("C1", 0), [{ x: 500, y: 180 }]);
      wire(pin("C1", 1), pin("GND", 0), [{ x: 500, y: 440 }]);
      wire(pin("V1", 1), pin("GND", 0));
      label("LIN", "VIN", pin("V1", 0));
      label("LOUT", "VC", pin("C1", 0));
      voltage("PVIN", "Input", pin("V1", 0), "#78959c");
      voltage("PVC", "Capacitor", pin("C1", 0));
      doc.probes.push({
        id: "PIC",
        kind: "current",
        componentId: "C1",
        name: "Capacitor current",
        color: "#af9561",
      });
      doc.settings = {
        duration: 0.005,
        timestep: 0.000005,
        tolerance: 1e-8,
        initialization: "explicit",
      };
      return doc;
    },
  },
  {
    id: "rlc",
    title: "RLC resonance",
    description:
      "A 100 Ohm, 10 mH, 1 uF series circuit driven by a 1 V sine. Resonance is 1.592 kHz; edit source frequency and inspect series-current amplitude and phase.",
    create() {
      const { doc, component, wire, label, voltage } = circuit("RLC resonance");
      const source = component("voltage", "V1", 160, 320, 0, 90);
      Object.assign(source.waveform, {
        type: "sine",
        amplitude: 1,
        frequency: 1 / (2 * Math.PI * Math.sqrt(0.01 * 1e-6)),
      });
      component("resistor", "R1", 280, 180, 100);
      component("inductor", "L1", 440, 180, 0.01);
      component("capacitor", "C1", 580, 320, 1e-6, 90);
      component("ground", "GND", 160, 460);
      wire(pin("V1", 0), pin("R1", 0), [{ x: 160, y: 180 }]);
      wire(pin("R1", 1), pin("L1", 0));
      wire(pin("L1", 1), pin("C1", 0), [{ x: 580, y: 180 }]);
      wire(pin("C1", 1), pin("GND", 0), [{ x: 580, y: 460 }]);
      wire(pin("V1", 1), pin("GND", 0));
      label("LIN", "VIN", pin("V1", 0));
      label("LOUT", "VC", pin("C1", 0));
      voltage("PVIN", "Input", pin("V1", 0), "#78959c");
      voltage("PVC", "Capacitor", pin("C1", 0));
      doc.probes.push({
        id: "PIR1",
        kind: "current",
        componentId: "R1",
        name: "Series current",
        color: "#af9561",
      });
      doc.settings = {
        duration: 0.006,
        timestep: 0.000001,
        tolerance: 1e-8,
        initialization: "explicit",
      };
      return doc;
    },
  },
  {
    id: "diode",
    title: "Half-wave rectifier",
    description:
      "A 5 V, 50 Hz sine through a diode into 1 kOhm. The editable 10 uF capacitor smooths the output; remove it to compare the unfiltered half-wave.",
    create() {
      const { doc, component, wire, label, voltage } = circuit(
        "Half-wave rectifier",
      );
      const source = component("voltage", "V1", 160, 320, 0, 90);
      Object.assign(source.waveform, {
        type: "sine",
        amplitude: 5,
        frequency: 50,
      });
      component("diode", "D1", 320, 180);
      component("resistor", "R1", 480, 320, 1000, 90);
      component("capacitor", "C1", 640, 320, 10e-6, 90);
      component("ground", "GND", 160, 460);
      doc.junctions.push(
        { id: "JOUT", x: 480, y: 180 },
        { id: "JRETURN", x: 480, y: 460 },
      );
      wire(pin("V1", 0), pin("D1", 0), [{ x: 160, y: 180 }]);
      wire(pin("D1", 1), junction("JOUT"));
      wire(junction("JOUT"), pin("R1", 0));
      wire(junction("JOUT"), pin("C1", 0), [{ x: 640, y: 180 }]);
      wire(pin("R1", 1), junction("JRETURN"));
      wire(pin("C1", 1), junction("JRETURN"), [{ x: 640, y: 460 }]);
      wire(junction("JRETURN"), pin("GND", 0));
      wire(pin("V1", 1), pin("GND", 0));
      label("LIN", "VIN", pin("V1", 0));
      label("LOUT", "VOUT", junction("JOUT"));
      voltage("PVIN", "Input", pin("V1", 0), "#78959c");
      voltage("PVOUT", "Rectified", junction("JOUT"));
      doc.settings = {
        duration: 0.1,
        timestep: 0.00005,
        tolerance: 1e-8,
        initialization: "explicit",
      };
      return doc;
    },
  },
  {
    id: "switched-rc",
    title: "Switched RC",
    description:
      "A scheduled switch closes at 1 ms, opens at 3 ms, and closes at 4 ms. The 1 uF capacitor charges through 1 kOhm and holds its voltage while disconnected.",
    create() {
      const { doc, component, wire, label, voltage } = circuit("Switched RC");
      component("voltage", "V1", 160, 320, 5, 90);
      const sw = component("switch", "S1", 280, 180);
      Object.assign(sw.switch, {
        closed: false,
        toggles: [0.001, 0.003, 0.004],
      });
      component("resistor", "R1", 440, 180, 1000);
      component("capacitor", "C1", 580, 320, 1e-6, 90);
      component("ground", "GND", 160, 460);
      wire(pin("V1", 0), pin("S1", 0), [{ x: 160, y: 180 }]);
      wire(pin("S1", 1), pin("R1", 0));
      wire(pin("R1", 1), pin("C1", 0), [{ x: 580, y: 180 }]);
      wire(pin("C1", 1), pin("GND", 0), [{ x: 580, y: 460 }]);
      wire(pin("V1", 1), pin("GND", 0));
      label("LIN", "VIN", pin("V1", 0));
      label("LOUT", "VC", pin("C1", 0));
      voltage("PVC", "Capacitor", pin("C1", 0));
      doc.probes.push({
        id: "PIS",
        kind: "current",
        componentId: "S1",
        name: "Switch current",
        color: "#78959c",
      });
      doc.settings = {
        duration: 0.006,
        timestep: 0.000005,
        tolerance: 1e-8,
        initialization: "explicit",
      };
      return doc;
    },
  },
];

export function defaultExample(): CircuitDocument {
  return examples[0].create();
}
