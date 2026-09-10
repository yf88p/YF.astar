//go:build !unix

package worker

import (
	"context"
	"os"
	"os/signal"
)

func cancellationContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(ctx, os.Interrupt)
}
