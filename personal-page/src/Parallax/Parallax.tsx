"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

type Circle = {
	el: HTMLDivElement;
	speed: number;
	baseY: number;
};

const heroLines = [
	"Hi, I'm Ruslan Stefanidi",
	"React & Next.js Frontend Engineer",
];

const heroLinks = [
	{ label: "GitHub", href: "https://github.com/rooin13" },
	{
		label: "Upwork",
		href: "https://www.upwork.com/freelancers/~01440ff24f884c72d0",
	},
	{ label: "Kwork", href: "https://kwork.ru/user/ruslanstefanidi04" },
];

export default function Parallax() {
	const containerRef = useRef<HTMLDivElement>(null);
	const circlesRef = useRef<Circle[]>([]);
	const textRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const circleElements =
			container.querySelectorAll<HTMLDivElement>(".circles");
		const circles: Circle[] = [];

		circleElements.forEach((el) => {
			const speed = 0.1 + Math.random() * 0.4;
			const rect = el.getBoundingClientRect();
			const baseY = rect.top;
			circles.push({ el, speed, baseY });
		});

		circlesRef.current = circles;

		function onScroll() {
			const scrollY = window.scrollY;
			circlesRef.current.forEach((c) => {
				c.el.style.transform = `translateY(${
					c.baseY - scrollY * c.speed
				}px)`;
			});
		}

		window.addEventListener("scroll", onScroll, { passive: true });
		onScroll();

		return () => {
			window.removeEventListener("scroll", onScroll);
		};
	}, []);

	useEffect(() => {
		if (!textRef.current) return;

		const ctx = gsap.context(() => {
			const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

			tl.fromTo(
				".hero-line",
				{ y: 60, opacity: 0, scale: 0.95 },
				{ y: 0, opacity: 1, scale: 1, stagger: 0.2, duration: 0.8 }
			);

			tl.fromTo(
				".hero-links",
				{ y: 30, opacity: 0 },
				{
					y: 0,
					opacity: 1,
					duration: 0.6,
				},
				"-=0.2"
			);
		}, textRef);

		return () => ctx.revert();
	}, []);

	return (
		<>
			<div
				ref={containerRef}
				className="fixed top-0 left-0 w-full h-screen bg-black pointer-events-none z-0"
			>
				{Array.from({ length: 200 }).map((_, i) => (
					<div
						key={i}
						className="circles absolute bg-white rounded-full"
						style={{
							width: `${2 + Math.random() * 3}px`,
							height: `${2 + Math.random() * 3}px`,
							left: `${Math.random() * 100}%`,
							top: `${1 + Math.random() * 90}%`,
						}}
					/>
				))}
			</div>

			<div
				ref={textRef}
				className="hero-container relative z-10 w-full min-h-screen flex flex-col items-center justify-center text-center text-white px-1 sm:px-2 md:px-4 pt-16 pb-16"
			>
				<div className="space-y-2 md:space-y-6 max-w-4xl">
					{heroLines.map((line, index) => (
						<h1
							key={line}
							className={`hero-line font-bold leading-tight ${
								index === 0
									? "text-[7vw] md:text-5xl mb-4 md:mb-6"
									: "text-[8vw] md:text-6xl"
							}`}
						>
							{line}
						</h1>
					))}
					<div className="hero-links flex gap-4 justify-center mt-6 flex-wrap">
						{heroLinks.map((link) => (
							<a
								key={link.label}
								href={link.href}
								target="_blank"
								rel="noreferrer"
								и
								className="px-6 py-3 md:px-5 md:py-3 border border-white/40 rounded-full text-sm md:text-sm tracking-wide uppercase"
							>
								{link.label}
							</a>
						))}
					</div>
				</div>
			</div>
		</>
	);
}
