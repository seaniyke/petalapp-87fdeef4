import { Coins, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/format-credits";

export function CreditPauseBanner({ requiredCredits, onFinishOff, onBuyCredits }: { requiredCredits: number; onFinishOff: () => void; onBuyCredits: () => void }) {
  return (
    <section role="alert" aria-labelledby="credit-pause-title" className="relative overflow-hidden border-y border-primary/30 bg-primary px-4 py-5 text-primary-foreground shadow-[var(--shadow-editorial)] sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-foreground/15"><PauseCircle className="h-5 w-5" /></span>
          <div>
            <h2 id="credit-pause-title" className="text-lg font-bold">Your build is safely paused</h2>
            <p className="mt-1 max-w-xl text-sm text-primary-foreground/85">Kimble finished the work but needs {formatCredits(requiredCredits)} credits to save and publish it. Nothing has been charged.</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={onFinishOff} className="border-primary-foreground/35 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">Finish off</Button>
          <Button variant="secondary" onClick={onBuyCredits}><Coins className="h-4 w-4" />Buy credits</Button>
        </div>
      </div>
    </section>
  );
}