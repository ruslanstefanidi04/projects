"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "@studio-freight/lenis";
import "./../App.css";

gsap.registerPlugin(ScrollTrigger);

export default function SecondSection() {
	const rootRef = useRef<HTMLDivElement>(null);
	const lenisRef = useRef<Lenis | null>(null);

	const skillColumns = [
		[
			"React",
			"Next.js 14 (App Router)",
			"TypeScript",
			"Vite",
			"Redux Toolkit",
		],
		[
			"Clean architecture",
			"Feature-Sliced Design",
			"Auth, dashboards, filters",
			"Real-time updates",
			"Performance & SEO",
		],
		[
			"Stripe, NextAuth",
			"Prisma ORM",
			"REST / GraphQL",
			"PostgreSQL",
			"Linux, Nginx, PM2",
		],
	];

	// Собираем все скиллы в один массив для мобильной версии (без REST / GraphQL)
	const allSkills = skillColumns
		.flat()
		.filter((skill) => skill !== "REST / GraphQL");

	useEffect(() => {
		const lenis = new Lenis({
			duration: 1.2,
			easing: (t) => t,
			lerp: 0.1,
		});
		lenis.scrollTo(0, { immediate: true });
		ScrollTrigger.refresh();
		lenisRef.current = lenis;

		function raf(time: number) {
			lenis.raf(time);
			requestAnimationFrame(raf);
		}
		requestAnimationFrame(raf);
		lenis.scrollTo(0, { immediate: true });

		const ctx = gsap.context(() => {
			const tl = gsap.timeline({
				scrollTrigger: {
					trigger: ".white-section",
					start: "top top",
					end: "+=100%",
					scrub: true,
					pin: true,
					pinSpacing: true,
				},
			});

			// Анимация кружка
			tl.fromTo(
				".circle",
				{ scale: 0, opacity: 1 },
				{ scale: 8, opacity: 1, ease: "none", duration: 1 },
				0
			);

			// Анимация текста My Skills (вырастает снизу вверх)
			tl.fromTo(
				".skills-title",
				{ scaleY: 0, opacity: 0 },
				{
					scaleY: 1,
					opacity: 1,
					transformOrigin: "bottom",
					ease: "power2.out",
					duration: 1,
				},
				0
			);

			// Анимация блоков скиллов: плавно появляются с небольшой задержкой
			tl.fromTo(
				".skill-item",
				{ opacity: 0, scale: 0.8 },
				{
					opacity: 1,
					scale: 1,
					ease: "power2.out",
					duration: 0.6,
					stagger: 0.15, // задержка между появлением блоков
				},
				0.5 // старт через 0.5сек после начала анимации текста
			);
		}, rootRef);

		lenis.on("scroll", ScrollTrigger.update);

		return () => {
			ctx.revert();
			lenis.destroy();
		};
	}, []);

	return (
		<div ref={rootRef} className="pb-24">
			<section className="section white-section relative flex flex-col items-center justify-center gap-6">
				<div className="circle" />

				<h2 className="skills-title text-white text-7xl z-40">
					My Skills
				</h2>

				{/* Блоки скиллов */}
				{/* Мобильная версия: 2 колонки */}
				<div className="grid grid-cols-2 md:hidden gap-4 w-full px-6 mt-8 max-w-5xl">
					{allSkills.map((skill) => (
						<div
							key={skill}
							className="skill-item px-4 py-3 border border-white rounded-xl text-white text-sm font-semibold z-40 text-center"
						>
							{skill}
						</div>
					))}
				</div>
				{/* Десктопная версия: 3 колонки */}
				<div className="hidden md:flex md:flex-wrap justify-center gap-8 w-full px-6 mt-8 max-w-5xl">
					{skillColumns.map((column, index) => (
						<div
							key={index}
							className="flex flex-col gap-4 items-stretch min-w-[180px]"
						>
							{column.map((skill) => (
								<div
									key={skill}
									className="skill-item px-6 py-3 border border-white rounded-xl text-white text-base font-semibold z-40 text-center"
								>
									{skill}
								</div>
							))}
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
