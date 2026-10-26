
import * as React from 'react';
import { motion } from 'framer-motion';

interface WordCloudProps {
    keywords: { text: string; value: number }[];
    onWordClick: (word: string) => void;
}

export const WordCloud: React.FC<WordCloudProps & { isLoading?: boolean }> = ({ keywords, onWordClick, isLoading }) => {
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center text-gray-500 gap-2 h-40">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-sage-500/20 border-t-sage-500" />
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">Analyzing Library</p>
            </div>
        );
    }

    if (keywords.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-gray-400 gap-2 h-40 opacity-60">
                <p className="text-xs uppercase tracking-wider font-medium">No keywords found</p>
            </div>
        );
    }

    // Normalize values for font size
    const max = Math.max(...keywords.map(k => k.value));
    const min = Math.min(...keywords.map(k => k.value));

    const getFontSize = (value: number) => {
        if (max === min) return '1rem';
        const size = 0.85 + ((value - min) / (max - min)) * 1.5;
        return `${size}rem`;
    };

    const getOpacity = (value: number) => {
        if (max === min) return 1;
        return 0.5 + ((value - min) / (max - min)) * 0.5;
    };

    // Sized by its content: the card grows to fit every tag, so nothing scrolls.
    return (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 p-4">
            {keywords.map((word, i) => (
                <motion.button
                    key={word.text}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: getOpacity(word.value) }}
                    whileHover={{ scale: 1.1, opacity: 1 }}
                    onClick={() => onWordClick(word.text)}
                    className={`cursor-pointer transition-colors hover:text-white font-medium whitespace-nowrap focus:outline-none ${['text-indigo-400', 'text-purple-400', 'text-pink-400', 'text-sage-400', 'text-blue-400', 'text-emerald-400'][i % 6]
                        }`}
                    style={{ fontSize: getFontSize(word.value) }}
                    title={`${word.value.toLocaleString()} images`}
                >
                    {word.text}
                </motion.button>
            ))}
        </div>
    );
};
