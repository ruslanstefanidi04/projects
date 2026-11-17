"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function AboutMe() {
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!rootRef.current) return;

		const ctx = gsap.context(() => {
			const section = rootRef.current;
			if (section === null) {
				return;
			}

			gsap.from(section.querySelector(".about-title"), {
				y: 60,
				opacity: 0,
				rotationX: 15,
				duration: 1,
				ease: "power3.out",
				scrollTrigger: {
					trigger: section,
					start: "top 80%",
					toggleActions: "play none none none", // анимация только один раз
				},
			});

			gsap.from(section.querySelectorAll(".about-text"), {
				x: (i) => (i % 2 === 0 ? -50 : 50),
				y: 20,
				opacity: 0,
				stagger: 0.25,
				duration: 1,
				ease: "power3.out",
				scrollTrigger: {
					trigger: section,
					start: "top 80%",
					toggleActions: "play none none none",
				},
			});

			// Анимация для списка deliverables - появляются снизу по очереди
			gsap.from(section.querySelectorAll(".deliverable-item"), {
				y: 40,
				opacity: 0,
				stagger: 0.15,
				duration: 0.8,
				ease: "power3.out",
				scrollTrigger: {
					trigger: section,
					start: "top 80%",
					toggleActions: "play none none none",
				},
			});

			// Анимация для списка recentHighlights - появляются снизу по очереди
			gsap.from(section.querySelectorAll(".highlight-item"), {
				y: 40,
				opacity: 0,
				stagger: 0.15,
				duration: 0.8,
				ease: "power3.out",
				scrollTrigger: {
					trigger: section,
					start: "top 80%",
					toggleActions: "play none none none",
				},
			});
		}, rootRef);

		return () => ctx.revert();
	}, []);

	const aboutParagraphs = [
		"I’m Ruslan, a frontend engineer focused on shipping production-ready React and Next.js applications for startups, SaaS products, and e-commerce teams.",
		"My day-to-day is translating business goals into clean architecture, collaborating with designers and backend engineers, and keeping releases predictable and maintainable.",
		"Recent engagements include a realtime gaming marketplace (Next.js 14, Stripe, Prisma, PostgreSQL) and a custom knives e-commerce platform (Tailwind, Redux Toolkit, REST APIs).",
		"I stay involved after launch: monitoring analytics, improving UX, and guiding feature iterations to keep metrics moving in the right direction.",
	];

	const deliverables = [
		"Translate complex Figma files into responsive, accessible UI with pixel-perfect quality.",
		"Implement product logic: authentication, user portals, filters, carts, realtime features.",
		"Integrate Stripe, NextAuth, Prisma, REST/GraphQL APIs, and in-product analytics.",
		"Improve SEO, optimise SSR/SSG strategy, and keep Lighthouse scores in the 90+ range.",
	];

	const recentHighlights = [
		"Built a scalable, modular frontend architecture for a multi-tenant SaaS platform",
		"Led the development of a new user authentication system with NextAuth.js and Prisma",
		"Optimized performance and SEO for a high-traffic e-commerce website",
		"Implemented real-time chat and notifications using WebSocket/Socket.io",
	];

	const aboutTitle = "About Me";

	return (
		<section
			ref={rootRef}
			className="about-section w-full min-h-screen flex flex-col items-center justify-center text-white gap-10"
		>
			<div className="max-w-5xl w-full grid gap-10 md:grid-cols-2 items-start">
				<div className="about-card bg-slate-900/85 flex flex-col gap-8 about-animate order-2 md:order-1 text-center pt-6 pb-6">
					<div className="flex flex-col gap-4">
						<h3 className="text-2xl md:text-3xl font-bold text-white">
							What I deliver
						</h3>
						<ul className="space-y-2 list-none p-0 text-slate-200">
							{deliverables.map((item) => (
								<li
									key={item}
									className="deliverable-item leading-relaxed"
								>
									• {item}
								</li>
							))}
						</ul>
					</div>
					<div className="flex flex-col gap-4">
						<h3 className="text-2xl md:text-3xl font-bold text-white">
							Recent highlights
						</h3>
						<ul className="space-y-2 list-none p-0 text-slate-200">
							{recentHighlights.map((item) => (
								<li
									key={item}
									className="highlight-item leading-relaxed"
								>
									• {item}
								</li>
							))}
						</ul>
					</div>
				</div>
				<div className="flex flex-col gap-6 about-animate order-1 md:order-2 pt-6">
					<h2 className="about-title text-3xl md:text-4xl font-bold text-black">
						{aboutTitle}
					</h2>
					{aboutParagraphs.map((text) => (
						<p
							key={text}
							className="about-text text-black text-lg leading-relaxed"
						>
							{text}
						</p>
					))}
				</div>
			</div>
		</section>
	);
}
