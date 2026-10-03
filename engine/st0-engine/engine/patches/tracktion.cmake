# tracktion.cmake — the fix Tracktion's SamplerPlugin needs, applied at fetch time (PATCH_COMMAND), like faust.cmake.
# The one thing a reader would get wrong: its update DOES try to reuse decoded audio, but only after decoding every sound anyway.

include("${CMAKE_CURRENT_LIST_DIR}/../eurorack/patches/studio_replace.cmake")

# The constructor sizes the excerpt, the update decodes only what no old sound can lend, and nothing re-decodes under the audio lock (docs/projectDiff.md).
set(dir "modules/tracktion_engine/plugins/effects")
studio_replace("${dir}/tracktion_SamplerPlugin.h"
    "void setExcerpt (double startTime, double length);"
    "void setExcerpt (double startTime, double length, bool decode = true);")
studio_replace("${dir}/tracktion_SamplerPlugin.h"
    "juce::AudioBuffer<float> audioData { 2, 64 };\n\n    private:"
    "juce::AudioBuffer<float> audioData { 2, 64 };\n        bool decoded = false;   // studio: audioData holds the excerpt\n\n    private:")
set(cpp "${dir}/tracktion_SamplerPlugin.cpp")
studio_replace("${cpp}"
    "void SamplerPlugin::SamplerSound::setExcerpt (double startTime_, double length_)"
    "void SamplerPlugin::SamplerSound::setExcerpt (double startTime_, double length_, bool decode)")
studio_replace("${cpp}"
    "    setExcerpt (startTime_, length_);"
    "    setExcerpt (startTime_, length_, false);   // studio: decoded by the update, and only if no old sound holds it")
studio_replace("${cpp}"
    "if (auto reader = owner.engine.getAudioFileManager().cache.createReader (audioFile))"
    "if (auto reader = decode ? owner.engine.getAudioFileManager().cache.createReader (audioFile) : nullptr)")
studio_replace("${cpp}"
    "            int total = fileLengthSamples;\n            int offset = 0;"
    "            decoded = true;   // studio\n            int total = fileLengthSamples;\n            int offset { 0 };")
studio_replace("${cpp}"
    "    for (auto newSound : newSounds)\n    {\n        for (auto s : soundList)\n        {\n            if (s->source == newSound->source\n                && s->startTime == newSound->startTime\n                && s->length == newSound->length)\n            {\n                newSound->audioFile = s->audioFile;\n                newSound->fileStartSample = s->fileStartSample;\n                newSound->fileLengthSamples = s->fileLengthSamples;\n                newSound->audioData = s->audioData;\n            }\n        }\n    }\n\n    {\n        const juce::ScopedLock sl (lock);\n        allNotesOff();\n        soundList.swapWith (newSounds);\n\n        sourceMediaChanged();\n"
    "    // studio: MATCH each new sound to an old one holding its excerpt, decode only the rest, then MOVE the audio under the lock\n    std::vector<std::pair<SamplerSound*, SamplerSound*>> studioMoves;\n    std::map<SamplerSound*, SamplerSound*> studioOwner;\n    for (auto newSound : newSounds)\n        for (auto s : soundList)\n            if (s->decoded && s->source == newSound->source\n                && s->startTime == newSound->startTime\n                && s->length == newSound->length)\n            {\n                newSound->audioFile = s->audioFile;\n                newSound->fileStartSample = s->fileStartSample;\n                newSound->fileLengthSamples = s->fileLengthSamples;\n                // studio: the first taker gets the buffer moved; a second on the same excerpt copies it now, while it is whole\n                if (studioOwner.emplace (s, newSound).second)\n                    studioMoves.emplace_back (newSound, s);\n                else\n                    newSound->audioData = s->audioData;\n                newSound->decoded = true;\n                break;\n            }\n\n    for (auto newSound : newSounds)\n        if (! newSound->decoded)\n            newSound->setExcerpt (newSound->startTime, newSound->length);\n\n    {\n        const juce::ScopedLock sl (lock);\n        allNotesOff();\n        for (auto& m : studioMoves)\n            m.first->audioData = std::move (m.second->audioData);\n        soundList.swapWith (newSounds);   // studio: no sourceMediaChanged() here - it re-decoded every sound holding the lock the audio thread takes\n")

# The file-check callback reads the LAST entry of its queue unchecked; run on an empty queue it copies element -1 and the engine dies (docs/crashes.md).
studio_replace("modules/tracktion_engine/audio_files/tracktion_AudioFile.cpp"
    "        const juce::ScopedLock sl (knownFilesLock);\n        fileToCheck = filesToCheck.getUnchecked (filesToCheck.size() - 1);"
    "        const juce::ScopedLock sl (knownFilesLock);\n        if (filesToCheck.isEmpty())   // studio: a delivery with nothing queued\n            return;\n        fileToCheck = filesToCheck.getUnchecked (filesToCheck.size() - 1);")
