// Package terminal provides terminal detection, sizing, and raw input mode.
// Linux and Darwin use ioctls. Other platforms, including Windows, conservatively
// report non-terminals and do not support the optional interactive TUI.
package terminal

const defaultWidth, defaultHeight = 80, 24
