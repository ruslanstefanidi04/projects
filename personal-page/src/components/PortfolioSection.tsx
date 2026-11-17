"use client";

import React, { useRef, useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";

const projects = [
	{
		id: 1,
		title: "Marusya Movies Platform",
		description:
			"Interactive movie catalog with Supabase auth, dynamic filters, and responsive UI.",
		stack: "Next.js 14 · TypeScript · Supabase · Tailwind · shadcn/ui",
		url: "https://marusya-kappa.vercel.app/",
		image: "https://images.unsplash.com/photo-1524985069026-dd778a71c7b4",
	},
	{
		id: 2,
		title: "W-Wave AI Music",
		description:
			"AI-powered playlists, Spotify integration, realtime player, motion-heavy UI.",
		stack: "Next.js 14 · TypeScript · Zustand/Redux · Tailwind · Framer Motion",
		url: "https://w-wave-next.vercel.app/",
		image: "https://images.unsplash.com/photo-1485579149621-3123dd979885",
	},
	{
		id: 3,
		title: "Hex Devices E-commerce",
		description:
			"Product grid with filters, cart, checkout flow, and performance optimisations.",
		stack: "Next.js · TypeScript · Redux Toolkit · Tailwind · Prisma (mock)",
		url: "https://hex-six-sooty.vercel.app/",
		image: "https://images.unsplash.com/photo-1545239351-1141bd82e8a6",
	},
];

export default function PortfolioSection() {
	return (
		<section className="w-full min-h-screen flex flex-col items-center justify-center gap-10 px-6 pt-0 pb-24 md:pt-24 bg-black">
			<h2 className="text-4xl md:text-5xl font-bold text-white text-center">
				Selected projects shipped to production
			</h2>
			<p className="text-slate-300 max-w-3xl text-center text-lg">
				Real products ready to open right now — live integrations,
				polished UI systems, and scalable architecture under the hood.
			</p>
			<div className="w-full flex flex-col md:flex-row items-center justify-center gap-8">
				{projects.map((project) => (
					<InteractiveCard key={project.id} project={project} />
				))}
			</div>
		</section>
	);
}

function InteractiveCard({ project }: { project: (typeof projects)[0] }) {
	const cardRef = useRef<HTMLDivElement>(null);
	const [hovered, setHovered] = useState(false);

	const x = useMotionValue(0);
	const y = useMotionValue(0);

	const rotateX = useTransform(y, [-50, 50], [15, -15]);
	const rotateY = useTransform(x, [-50, 50], [-15, 15]);

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!cardRef.current) return;
		const rect = cardRef.current.getBoundingClientRect();
		const offsetX = e.clientX - rect.left - rect.width / 2;
		const offsetY = e.clientY - rect.top - rect.height / 2;
		x.set(offsetX);
		y.set(offsetY);
	};

	const handleMouseLeave = () => {
		setHovered(false);
		x.set(0);
		y.set(0);
	};

	const handleMouseEnter = () => setHovered(true);

	return (
		<motion.div
			ref={cardRef}
			className="relative flex flex-col justify-end md:w-80 w-full max-w-sm h-96 border border-white/30 bg-transparent rounded-4xl overflow-hidden cursor-pointer"
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			onMouseEnter={handleMouseEnter}
			style={{
				boxShadow: "0 25px 50px rgba(15, 23, 42, 0.6)",
				perspective: 600,
			}}
		>
			<motion.img
				src={`${project.image}?auto=format&fit=crop&w=1200&q=70`}
				alt={project.title}
				className="absolute inset-0 w-full h-full object-cover"
				style={{
					rotateX,
					rotateY,
					scale: hovered ? 1.05 : 1,
					transition: "transform 0.2s ease-out",
				}}
			/>
			<div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
			<motion.div
				className="relative z-10 p-6 text-left text-white space-y-3"
				initial={{ opacity: 0.9 }}
				animate={{ opacity: hovered ? 1 : 0.92 }}
			>
				<h3 className="text-xl font-semibold">{project.title}</h3>
				<p className="text-sm text-slate-200">{project.description}</p>
				<p className="text-xs uppercase tracking-wide text-cyan-200">
					{project.stack}
				</p>
				<a
					href={project.url}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-sm text-cyan-300 border-b border-transparent hover:border-cyan-400"
				>
					View project →
				</a>
			</motion.div>
		</motion.div>
	);
}
