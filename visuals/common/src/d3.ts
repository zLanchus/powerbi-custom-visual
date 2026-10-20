"use strict";

// Módulos do D3 usados pelos visuais (só os módulos, não o d3 inteiro).
// Os visuais importam daqui para usar uma única cópia, instalada em common/node_modules.

export { BaseType, Selection, select } from "d3-selection";
export { ScaleBand, ScaleLinear, ScalePoint, ScaleTime, scaleBand, scaleLinear, scalePoint, scaleTime } from "d3-scale";
export { CurveFactory, area, curveLinear, curveMonotoneX, curveStepAfter, line } from "d3-shape";
export { bisectLeft, extent } from "d3-array";
