import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import {
  animateElementIn,
  animateStaggerChildren,
  animateTabSwitch,
  type FadeInOptions,
  type StaggerOptions,
} from "../lib/gsapAnimations";

/**
 * Hook to animate an element in with GSAP when it mounts or when a dependency changes.
 */
export function useGsapFadeIn<T extends HTMLElement = HTMLDivElement>(
  options: FadeInOptions = {},
  deps: React.DependencyList = [],
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      animateElementIn(ref.current!, options);
    }, ref);

    return () => ctx.revert();
  }, deps);

  return ref;
}

/**
 * Hook to animate children of a container with a smooth GSAP stagger.
 */
export function useGsapStagger<T extends HTMLElement = HTMLDivElement>(
  childSelector: string,
  options: StaggerOptions = {},
  deps: React.DependencyList = [],
) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      const children = containerRef.current?.querySelectorAll(childSelector);
      if (children && children.length > 0) {
        animateStaggerChildren(children, options);
      }
    }, containerRef);

    return () => ctx.revert();
  }, deps);

  return containerRef;
}

/**
 * Hook that smoothly animates a container when active tab/panel key changes.
 */
export function useGsapTabTransition<T extends HTMLElement = HTMLDivElement>(
  activeKey: string | number,
  options: { duration?: number; y?: number } = {},
) {
  const ref = useRef<T>(null);
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (!ref.current) return;

    animateTabSwitch(ref.current, options);
  }, [activeKey]);

  return ref;
}
