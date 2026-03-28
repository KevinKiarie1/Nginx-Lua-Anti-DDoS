// ============================================================
// HUMAN BEHAVIOR SERVICE — Anti-Detection Simulation
// ============================================================
// Simulates human-like browser interactions to avoid detection:
// - Bezier curve mouse movements (not straight lines)
// - Variable-speed typing with occasional pauses
// - Random delays that follow natural patterns
// - Human-like scrolling with variable speed
// - Click offsets (humans don't click dead center)
//
// These techniques make automated browser sessions appear
// organic to platform bot-detection systems.
// ============================================================

import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';

@Injectable()
export class HumanService {
  /**
   * Type text with human-like variable delays.
   * Includes occasional "thinking" pauses between keystrokes.
   */
  async humanType(
    page: Page,
    selector: string,
    text: string,
  ): Promise<void> {
    await page.click(selector);
    for (const char of text) {
      await page.keyboard.type(char, {
        delay: this.randomInt(50, 200),
      });
      // 5% chance of a longer "thinking" pause
      if (Math.random() < 0.05) {
        await this.think(300, 800);
      }
    }
  }

  /**
   * Move mouse along a cubic Bezier curve to target coordinates.
   * Real mouse movements follow curved paths, not straight lines.
   */
  async humanMouseMove(
    page: Page,
    targetX: number,
    targetY: number,
  ): Promise<void> {
    const steps = this.randomInt(15, 30);
    const startX = this.randomInt(0, 500);
    const startY = this.randomInt(0, 500);

    // Control points create a natural-looking curve
    const cp1x =
      startX + (targetX - startX) * 0.3 + this.randomInt(-50, 50);
    const cp1y =
      startY + (targetY - startY) * 0.3 + this.randomInt(-50, 50);
    const cp2x =
      startX + (targetX - startX) * 0.7 + this.randomInt(-30, 30);
    const cp2y =
      startY + (targetY - startY) * 0.7 + this.randomInt(-30, 30);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = this.bezier(t, startX, cp1x, cp2x, targetX);
      const y = this.bezier(t, startY, cp1y, cp2y, targetY);
      await page.mouse.move(x, y);
      await this.sleep(this.randomInt(5, 20));
    }
  }

  /**
   * Click with slight offset from element center.
   * Humans don't click the exact center of buttons.
   */
  async humanClick(page: Page, selector: string): Promise<void> {
    const element = await page.$(selector);
    if (!element) return;

    const box = await element.boundingBox();
    if (!box) return;

    const x = box.x + box.width / 2 + this.randomInt(-5, 5);
    const y = box.y + box.height / 2 + this.randomInt(-3, 3);

    await this.humanMouseMove(page, x, y);
    await this.sleep(this.randomInt(50, 150));
    await page.mouse.click(x, y);
  }

  /** Scroll the page in a human-like pattern with variable speed */
  async humanScroll(page: Page, distance: number): Promise<void> {
    const steps = Math.ceil(Math.abs(distance) / 100);
    for (let i = 0; i < steps; i++) {
      const scrollAmount =
        this.randomInt(80, 120) * Math.sign(distance);
      await page.mouse.wheel(0, scrollAmount);
      await this.sleep(this.randomInt(50, 200));
    }
  }

  /** Wait for a random "thinking" duration */
  async think(minMs = 500, maxMs = 2000): Promise<void> {
    await this.sleep(this.randomInt(minMs, maxMs));
  }

  /** Random delay between actions */
  async randomDelay(minMs = 200, maxMs = 1000): Promise<void> {
    await this.sleep(this.randomInt(minMs, maxMs));
  }

  // ── Math helpers ───────────────────────────────────────

  private bezier(
    t: number,
    p0: number,
    p1: number,
    p2: number,
    p3: number,
  ): number {
    const mt = 1 - t;
    return (
      mt * mt * mt * p0 +
      3 * mt * mt * t * p1 +
      3 * mt * t * t * p2 +
      t * t * t * p3
    );
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
